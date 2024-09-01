import { open } from "./mac";

export async function openUrl(url: string) {
  switch (process.platform) {
    case "darwin":
      return open({ url });
    default:
      throw new Error(`Opening URL is not supported on platform ${process.platform}`);
  }
}
