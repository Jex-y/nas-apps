import { expect, test } from "bun:test";
import { createNtfyNotifier, parseNotifyConfig } from "./notify";

test("publishes to the app's ntfy topic", async () => {
  const config = parseNotifyConfig(process.env);
  const topic = `test-${crypto.randomUUID()}`;

  await createNtfyNotifier(config.ntfy, topic).send({
    title: "New flat",
    message: "2 bed, Hackney, £450k",
    clickUrl: "https://example.com/flat",
    priority: "high",
    tags: ["house"],
  });

  const response = await fetch(`${config.ntfy.url}/${topic}/json?poll=1`);
  const [message] = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(message).toMatchObject({
    topic,
    title: "New flat",
    message: "2 bed, Hackney, £450k",
    click: "https://example.com/flat",
    priority: 4,
    tags: ["house"],
  });
});
