import WebSocketTransport from "./websocket-transport";
import { spawn, exec } from "child_process";
import { log } from "@ledgerhq/logs";

const data: any = {};
let idCounter = 0;

export const delay = (ms: number): Promise<void> =>
  new Promise((f) => setTimeout(f, ms));

export enum DeviceModelId {
    blue = "blue",
    nanoS = "nanoS",
    nanoSP = "nanoSP",
    nanoX = "nanoX",
  }

export async function releaseSpeculosDevice(id: string) {
    log("speculos", "release " + id);
    const obj = data[id];
  
    if (obj) {
      await obj.destroy();
    }
  }

  export function closeAllSpeculosDevices() {
    return Promise.all(Object.keys(data).map(releaseSpeculosDevice));
  }

export async function createSpeculosDevice(
    arg: {
      model: DeviceModelId;
      firmware: string;
      appName: string;
      appVersion: string;
      dependency?: string;
      seed: string;
      // Folder where we have app binaries
      coinapps: string;
    },
    maxRetry = 3
  ): Promise<{
    transport: WebSocketTransport;
    id: string;
  }> {
    const { model, firmware, appName, appVersion, seed, coinapps, dependency } =
      arg;
    const speculosID = `speculosID-${++idCounter}`;
    const apduPort = 40000 + idCounter;
    const vncPort = 41000 + idCounter;
    const buttonPort = 42000 + idCounter;
    const automationPort = 43000 + idCounter;
  
    // workaround until we have a clearer way to resolve sdk for a firmware.
    const sdk =
      model === "nanoX" ? "1.2" : model === "nanoS" ? firmware.slice(0, 3) : null;
  
    const appPath = `./apps/${model.toLowerCase()}/${firmware}/${appName.replace(
      / /g,
      ""
    )}/app_${appVersion}.elf`;
  
    const params = [
      "run",
      "-v",
      `${coinapps}:/speculos/apps`,
      "-p",
      `${apduPort}:40000`,
      "-p",
      `${vncPort}:41000`,
      "-p",
      `${buttonPort}:42000`,
      "-p",
      `${automationPort}:43000`,
      "-e",
      `SPECULOS_APPNAME=${appName}:${appVersion}`,
      "--name",
      `${speculosID}`,
      "ghcr.io/ledgerhq/speculos",
      "--model",
      model.toLowerCase(),
      appPath,
      ...(dependency
        ? [
            "-l",
            `${dependency}:${`./apps/${model.toLowerCase()}/${firmware}/${dependency}/app_${appVersion}.elf`}`,
          ]
        : []),
      ...(sdk ? ["--sdk", sdk] : []),
      "--display",
      "headless",
      "--vnc-password",
      "live",
      "--apdu-port",
      "40000",
      "--vnc-port",
      "41000",
      "--button-port",
      "42000",
      "--automation-port",
      "43000",
    ];
  
    log("speculos", `${speculosID}: spawning = ${params.join(" ")}`);
  
    const p = spawn("docker", [...params, "--seed", `${seed}`]);
  
    let resolveReady: any;
    let rejectReady: any;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let destroyed = false;
  
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      new Promise((resolve, reject) => {
        if (!data[speculosID]) return;
        delete data[speculosID];
        exec(`docker rm -f ${speculosID}`, (error, stdout, stderr) => {
          if (error) {
            log(
              "speculos-error",
              `${speculosID} not destroyed ${error} ${stderr}`
            );
            reject(error);
          } else {
            log("speculos", `destroyed ${speculosID}`);
            resolve(undefined);
          }
        });
      });
    };
  
    p.stdout.on("data", (data) => {
      if (data) {
        log("speculos-stdout", `${speculosID}: ${String(data).trim()}`);
      }
    });
    let latestStderr: any;
    p.stderr.on("data", (data) => {
      if (!data) return;
      latestStderr = data;
  
      if (!data.includes("apdu: ")) {
        log("speculos-stderr", `${speculosID}: ${String(data).trim()}`);
      }
  
      if (data.includes("using SDK")) {
        setTimeout(() => resolveReady(true), 500);
      } else if (data.includes("is already in use by container")) {
        rejectReady(
          new Error(
            "speculos already in use! Try `ledger-live cleanSpeculos` or check logs"
          )
        );
      } else if (data.includes("address already in use")) {
        if (maxRetry > 0) {
          log("speculos", "retrying speculos connection");
          destroy();
          resolveReady(false);
        }
      }
    });
    p.on("close", () => {
      log("speculos", `${speculosID} closed`);
  
      if (!destroyed) {
        destroy();
        rejectReady(new Error(`speculos process failure. ${latestStderr || ""}`));
      }
    });
    const hasSucceed = await ready;
  
    if (!hasSucceed) {
      await delay(1000);
      return createSpeculosDevice(arg, maxRetry - 1);
    }
  
    const transport = await WebSocketTransport.open("ws://localhost:4242");
    data[speculosID] = {
      process: p,
      apduPort,
      buttonPort,
      automationPort,
      transport,
      destroy,
    };
    return {
      id: speculosID,
      transport,
    };
  }