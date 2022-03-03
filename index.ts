import express from "express";
import cors from "cors";
import {
  listAppCandidates,
  createSpeculosDevice,
  releaseSpeculosDevice,
  findAppCandidate,
} from "@ledgerhq/live-common/lib/load/speculos";
import { getEnv } from "@ledgerhq/live-common/lib/env";

const PORT = process.env.PORT ?? "4343";
const app = express();
const seed = process.env.SEED;
if (!seed) {
  throw new Error("SEED is not set");
}
const coinapps = process.env.COINAPPS;
if (!coinapps) {
  throw new Error("COINAPPS is not set");
}

app.get("/app-candidate", async (req, res) => {
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
    const device = await createSpeculosDevice(req.body);

    return res.json(device);
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
