import type { CodePlaneClient } from "@codeplane/sdk";

export async function handleSubscribe(
  client: CodePlaneClient,
  args: string[]
) {
  const types = args.length > 0 ? args : ["*"];

  console.log(`\x1b[2mSubscribing to: ${types.join(", ")}\x1b[0m`);
  console.log(`\x1b[2mPress Ctrl+C to stop.\x1b[0m\n`);

  client.subscribe(types, (event) => {
    const time = new Date().toLocaleTimeString();
    const color = event.type.startsWith("file.")
      ? "\x1b[36m"
      : event.type.startsWith("lease.")
        ? "\x1b[33m"
        : "\x1b[35m";
    console.log(
      `${color}${event.type}\x1b[0m \x1b[2m${time}\x1b[0m ${JSON.stringify(event.data)}`
    );
  });

  // Keep process alive
  await new Promise(() => {});
}
