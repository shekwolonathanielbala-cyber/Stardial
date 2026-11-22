import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { Response } from "express";
import { EventEmitter } from "events";
import { drainWrite } from "../routes/transactions.js";

const OWN_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_ADDRESS = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

const mockRecords = [
  {
    id: "tx-1",
    roundId: "round-1",
    recipient: OWN_ADDRESS,
    amount: "1000",
    token: "CAS3...",
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    txHash: "validhash123",
    status: "completed",
  },
];

const mockGetMany = vi.fn().mockResolvedValue(mockRecords);
const mockGetManyAndCount = vi.fn().mockResolvedValue([mockRecords, mockRecords.length]);

const mockQueryBuilder = {
  andWhere: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
  getMany: mockGetMany,
  getManyAndCount: mockGetManyAndCount,
};

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      createQueryBuilder: () => mockQueryBuilder,
    }),
  }),
  initDatabase: async () => {},
  closeDatabase: async () => {},
}));

// Session revocation (#1446) is covered in session-revocation.test.ts; these
// tests only need tokens at the current (default) version.
vi.mock("../services/session-revocation.js", () => ({
  getSessionVersion: vi.fn(async () => 0),
  getMaxSessionVersionForEmail: vi.fn(async () => 0),
  revokeSessionsForEmail: vi.fn(async () => 1),
}));

import { app } from "../index.js";
import { signToken } from "../services/jwt.js";

describe("GET /transactions/export", () => {
  it("rejects a request with no bearer token", async () => {
    const response = await request(app).get("/transactions/export");
    expect(response.status).toBe(401);
  });

  it("ignores a client-supplied walletAddress and scopes to the token's own wallet", async () => {
    const token = signToken(OWN_ADDRESS);
    // transactionExportQuerySchema has no walletAddress field at all, so
    // this is also validated at the schema layer, not just the service call.
    const response = await request(app)
      .get(`/transactions/export?format=json&walletAddress=${OTHER_ADDRESS}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      "transaction.recipient = :recipient",
      { recipient: OWN_ADDRESS },
    );
  });

  it("returns a paginated JSON page for format=json", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=json&limit=10&offset=0")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("transactions");
    expect(response.body).toHaveProperty("total", mockRecords.length);
    expect(response.body).toHaveProperty("limit", 10);
    expect(response.body).toHaveProperty("offset", 0);
  });

  it("streams a CSV by default with a header row and a downloadable filename", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain(".csv");

    const lines = response.text.trim().split("\r\n");
    expect(lines[0]).toBe("id,roundId,recipient,amount,token,timestamp,txHash,status");
    expect(lines[1]).toContain("tx-1");
    expect(lines[1]).toContain(OWN_ADDRESS);
  });

  it("sets Transfer-Encoding: chunked on the CSV response so intermediaries do not buffer the stream", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    // Express sets Transfer-Encoding: chunked for streaming responses that
    // have no Content-Length.  We also set it explicitly to signal intent
    // and prevent buffering proxies from reassembling the body.
    expect(response.headers["transfer-encoding"]).toBe("chunked");
  });

  it("sets Cache-Control: no-store on CSV exports to prevent proxy caching of sensitive data", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects an invalid format value", async () => {
    const token = signToken(OWN_ADDRESS);
    const response = await request(app)
      .get("/transactions/export?format=xml")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// drainWrite() unit tests (issue #33: backpressure handling)
// ---------------------------------------------------------------------------
//
// These tests verify the helper's behaviour in isolation without spinning up
// the full HTTP server or mock database.  They drive a fake Response-shaped
// EventEmitter so we can control the write-buffer state precisely.

function makeFakeRes(writeReturnValue: boolean): {
  res: Response;
  emitter: EventEmitter;
  writtenChunks: string[];
} {
  const emitter = new EventEmitter();
  const writtenChunks: string[] = [];

  const res = Object.assign(emitter, {
    write: vi.fn((chunk: string) => {
      writtenChunks.push(chunk);
      return writeReturnValue;
    }),
  }) as unknown as Response;

  return { res, emitter, writtenChunks };
}

describe("drainWrite()", () => {
  it("writes the chunk and resolves immediately when the buffer has space (write returns true)", async () => {
    const { res, writtenChunks } = makeFakeRes(true);

    await drainWrite(res, "hello\r\n");

    expect(writtenChunks).toEqual(["hello\r\n"]);
  });

  it("suspends until the drain event fires when the write buffer is full (write returns false)", async () => {
    const { res, emitter, writtenChunks } = makeFakeRes(false);

    let resolved = false;
    const p = drainWrite(res, "row\r\n").then(() => { resolved = true; });

    // The promise must not have resolved yet — buffer is still full.
    expect(resolved).toBe(false);

    // Simulate the socket draining.
    emitter.emit("drain");
    await p;

    expect(resolved).toBe(true);
    expect(writtenChunks).toEqual(["row\r\n"]);
  });

  it("resolves without deadlocking when the client disconnects before drain fires", async () => {
    const { res, emitter } = makeFakeRes(false);

    const p = drainWrite(res, "chunk\r\n");

    // Simulate a client disconnect instead of a drain.
    emitter.emit("close");
    await p; // must resolve, not hang

    // No assertion on the written chunk because whether write() was called
    // before or after close is an implementation detail; what matters is
    // that the promise settles.
  });

  it("does not add lingering event listeners after the write resolves normally", async () => {
    const { res, emitter } = makeFakeRes(false);

    const p = drainWrite(res, "data\r\n");
    emitter.emit("drain");
    await p;

    // After settlement, neither the drain nor close listener should remain.
    expect(emitter.listenerCount("drain")).toBe(0);
    expect(emitter.listenerCount("close")).toBe(0);
  });

  it("does not add lingering event listeners after resolving on close", async () => {
    const { res, emitter } = makeFakeRes(false);

    const p = drainWrite(res, "data\r\n");
    emitter.emit("close");
    await p;

    expect(emitter.listenerCount("drain")).toBe(0);
    expect(emitter.listenerCount("close")).toBe(0);
  });
});
