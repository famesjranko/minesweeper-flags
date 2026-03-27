import { describe, expect, it } from "vitest";
import { KeyedSerialTaskRunner } from "./keyed-serial-task-runner.js";

describe("keyed serial task runner", () => {
  it("serializes concurrent work for the same key", async () => {
    const taskRunner = new KeyedSerialTaskRunner();
    const executionOrder: string[] = [];
    let releaseFirstTask!: () => void;
    const firstTaskReady = new Promise<void>((resolve) => {
      releaseFirstTask = resolve;
    });

    const firstTask = taskRunner.run("room-1", async () => {
      executionOrder.push("first-start");
      await firstTaskReady;
      executionOrder.push("first-end");
    });
    const secondTask = taskRunner.run("room-1", async () => {
      executionOrder.push("second");
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(executionOrder).toEqual(["first-start"]);

    releaseFirstTask();
    await Promise.all([firstTask, secondTask]);

    expect(executionOrder).toEqual([
      "first-start",
      "first-end",
      "second"
    ]);
  });

  it("allows nested work for the same key without deadlocking", async () => {
    const taskRunner = new KeyedSerialTaskRunner();
    const executionOrder: string[] = [];

    await taskRunner.run("room-1", async () => {
      executionOrder.push("outer-start");

      await taskRunner.run("room-1", async () => {
        executionOrder.push("inner");
      });

      executionOrder.push("outer-end");
    });

    expect(executionOrder).toEqual([
      "outer-start",
      "inner",
      "outer-end"
    ]);
  });
});
