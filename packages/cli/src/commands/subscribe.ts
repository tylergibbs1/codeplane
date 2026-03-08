import type { CodePlaneClient } from "@codeplane/sdk";

export async function handleSubscribe(
  client: CodePlaneClient,
  args: string[]
) {
  const types = args.length > 0 ? args : ["*"];

  console.log(`Subscribing to: ${types.join(", ")}`);

  client.subscribe(types, (event) => {
    console.log(JSON.stringify(event));
  });

  // Keep process alive
  await new Promise(() => {});
}
