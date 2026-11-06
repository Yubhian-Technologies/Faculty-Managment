import http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { ccavEncrypt } from "./ccavenue";
import { CcavApiRefused, callApi, readApiAnswer, statusAsResponse, statusOutcome } from "./ccavenueApi";
import { proxyPostForm } from "./proxyPost";

const KEY = "ABCDEF0123456789ABCDEF0123456789";

describe("CCAvenue API answers", () => {
  it("decrypts status=0 answers, and refuses status=1 with their text", () => {
    const body = `status=0&enc_response=${ccavEncrypt(JSON.stringify({ order_status: "Successful" }), KEY)}`;
    expect(readApiAnswer(body, KEY)).toEqual({ order_status: "Successful" });
    expect(() => readApiAnswer("status=1&enc_response=Access_code: Invalid Parameter", KEY)).toThrow(/Invalid Parameter/);
  });

  it("maps CCAvenue's order statuses; in-progress ones change nothing", () => {
    expect(statusOutcome("Successful")).toBe("SUCCESS");
    expect(statusOutcome("Shipped")).toBe("SUCCESS");
    expect(statusOutcome("Aborted")).toBe("ABORTED");
    expect(statusOutcome("Auto-Cancelled")).toBe("ABORTED");
    expect(statusOutcome("Unsuccessful")).toBe("FAILED");
    expect(statusOutcome("Initiated")).toBeNull();
    expect(statusOutcome("Awaited")).toBeNull();
  });

  it("reads an order status answer like a checkout response (wrapped or not)", () => {
    const r = statusAsResponse("FMS1", { Order_Status_Result: { order_no: "FMS1", order_status: "Successful", order_amt: 150, reference_no: "3100", order_bank_ref_no: "BR", order_currncy: "INR", status: 0 } })!;
    expect(r).toMatchObject({ orderId: "FMS1", outcome: "SUCCESS", amount: 150, trackingId: "3100", bankRefNo: "BR", currency: "INR" });
    expect(statusAsResponse("FMS1", { order_status: "Awaited" })).toBeNull();
    expect(() => statusAsResponse("FMS1", { status: 1, error_desc: "No records found" })).toThrow(/No records/);
  });
});

describe("one key per proxy IP: callApi tries the keys in turn", () => {
  const K2 = "BBBBBB0123456789ABCDEF0123456789";
  const acc = { env: "TEST" as const, accessCode: "WEBSITE", workingKey: KEY, fallbacks: [{ accessCode: "IP2", workingKey: K2 }] };
  it("the website key is refused from this IP -> the IP's key is used", async () => {
    const tried: string[] = [];
    const post = async (_u: string, f: Record<string, string>) => {
      tried.push(f.access_code);
      return f.access_code === "IP2"
        ? { status: 200, body: `status=0&enc_response=${ccavEncrypt(JSON.stringify({ order_status: "Successful" }), K2)}` }
        : { status: 200, body: "status=1&enc_response=Access_code: Invalid Parameter" };
    };
    expect(await callApi(acc, "orderStatusTracker", { order_no: "FMS1" }, post)).toEqual({ order_status: "Successful" });
    expect(tried).toEqual(["WEBSITE", "IP2"]);
  });
  it("every key refused -> a clear refusal; a network error stops at once", async () => {
    await expect(callApi(acc, "x", {}, async () => ({ status: 200, body: "status=1&enc_response=IP not whitelisted" }))).rejects.toBeInstanceOf(CcavApiRefused);
    let n = 0;
    await expect(callApi(acc, "x", {}, async () => { n++; throw new Error("ECONNRESET"); })).rejects.toThrow("ECONNRESET");
    expect(n).toBe(1);
  });
});

describe("proxyPostForm (static-IP proxy only for payment calls)", () => {
  const prev = process.env.PAYMENT_PROXY_URL;
  let server: http.Server | null = null;
  afterEach(() => {
    server?.close(); server = null;
    if (prev === undefined) delete process.env.PAYMENT_PROXY_URL; else process.env.PAYMENT_PROXY_URL = prev;
  });

  it("refuses without PAYMENT_PROXY_URL (never calls CCAvenue directly)", async () => {
    delete process.env.PAYMENT_PROXY_URL;
    await expect(proxyPostForm("https://api.ccavenue.com/x", {})).rejects.toThrow("PAYMENT_PROXY_NOT_CONFIGURED");
  });

  it("tunnels with CONNECT to the target host and sends the proxy login", async () => {
    let seen: { method?: string; url?: string; auth?: string } = {};
    server = http.createServer();
    server.on("connect", (req, socket) => {
      seen = { method: req.method, url: req.url, auth: req.headers["proxy-authorization"] as string };
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    process.env.PAYMENT_PROXY_URL = `http://user:p%40ss@127.0.0.1:${port}`;
    await expect(proxyPostForm("https://api.ccavenue.com/apis/servlet/DoWebTrans", { a: "1" })).rejects.toThrow("PAYMENT_PROXY_CONNECT_407");
    expect(seen.method).toBe("CONNECT");
    expect(seen.url).toBe("api.ccavenue.com:443");
    expect(seen.auth).toBe(`Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  });

  it("only HTTPS targets", async () => {
    process.env.PAYMENT_PROXY_URL = "http://127.0.0.1:1";
    await expect(proxyPostForm("http://api.ccavenue.com/x", {})).rejects.toThrow("HTTPS_ONLY");
  });
});
