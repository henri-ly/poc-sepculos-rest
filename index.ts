import express, { json } from "express";
import SpeculosTransport from "@ledgerhq/hw-transport-node-speculos";
import {
  createSpeculosDevice,
  listAppCandidates,
  findAppCandidate,
  releaseSpeculosDevice,
} from "@ledgerhq/live-common/lib/load/speculos";
import WebSocket from "ws";

const PORT = process.env.PORT ?? "4343";
const app = express();
app.use(json());
const seed = process.env.SEED;
if (!seed) {
  throw new Error("SEED is not set");
}
const coinapps = process.env.COINAPPS;
if (!coinapps) {
  throw new Error("COINAPPS is not set");
}

const devicesList: Record<string, SpeculosTransport> = {};
const clientList: Record<string, WebSocket[]> = {};

const websocketServer = new WebSocket.Server({
  port: 8435,
});

type MessageProxySpeculos =
  | {
      type: "exchange" | "open" | "button" | "apdu";
      data: string;
    }
  | { type: "error"; error: string };

websocketServer.on("connection", (client, req) => {
  client.send(JSON.stringify({ message: "connected" }));

  const id = /[^/]*$/.exec(req.url || "")?.[0];
  if (!id) {
    return client.send(
      JSON.stringify({ type: "error", error: "id not found" })
    );
  }

  client.on("message", async (data) => {
    console.log("RECEIVED =>", data.toString());
    const message: MessageProxySpeculos = JSON.parse(data.toString());
    const device = devicesList[id];

    if (!device) {
      return client.send(
        JSON.stringify({ type: "error", error: "device not found" })
      );
    }

    try {
      switch (message.type) {
        case "open":
          client.send(JSON.stringify({ type: "opened" }));
          break;

        case "exchange":
          const res = await device.exchange(Buffer.from(message.data, "hex"));
          console.log("REPLY <=", res);
          client.send(JSON.stringify({ type: "response", data: res }));
          break;

        case "button":
          device.button(message.data);
          break;
      }
    } catch (e) {
      console.log(e);
      throw e;
    }
  });
});

app.post("/app-candidate", async (req, res) => {
  try {
    const appCandidates = await listAppCandidates(coinapps);
    const appCandidate = findAppCandidate(appCandidates, req.body);

    if (!appCandidate) {
      return res.status(404).send("No app candidate found");
    }

    return res.json(appCandidate);
  } catch (e: any) {
    console.log(e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.post("/", async (req, res) => {
  try {
    const device = await createSpeculosDevice({
      ...req.body,
      seed: seed,
      coinapps: coinapps,
    });

    console.log(device.id, "has been created");

    device.transport.automationSocket?.on("data", (data) => {
      console.log("[DATA of AUTOMATION SOCKET]", data.toString("ascii"));

      const split = data.toString("ascii").split("\n");
      split
        .filter((ascii) => !!ascii)
        .forEach((ascii) => {
          const json = JSON.parse(ascii);
          clientList[device.id].forEach((client) => {
            client.send(JSON.stringify({ type: "screen", data: json }));
          });
        });
    });

    device.transport.apduSocket?.on("data", (data) => {
      console.log("[DATA of APDU SOCKET]", data.toString("hex"));
    });

    devicesList[device.id] = device.transport;

    return res.json({ id: device.id });
  } catch (e: any) {
    console.log(e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.delete("/:id", async (req, res) => {
  try {
    await releaseSpeculosDevice(req.params.id);

    return res.json(`${req.params.id} is destroyed`);
  } catch (e: any) {
    console.log(e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Listen to :${PORT}`);
});
