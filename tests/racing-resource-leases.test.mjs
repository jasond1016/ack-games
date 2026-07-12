import assert from "node:assert/strict";
import test from "node:test";

import { createResourceLeaseCache } from "../racing-resource-leases.mjs";

test("资源租约并发复用一次加载且释放幂等", async () => {
  let loads = 0;
  const cache = createResourceLeaseCache({ load: async (value) => { loads += 1; return value; } });
  const [left, right] = await Promise.all([cache.acquire("car", 7), cache.acquire("car", 7)]);
  assert.equal(loads, 1);
  assert.equal(left.value, 7);
  left.release();
  left.release();
  right.release();
});

test("非保留资源在最后一个租约释放时销毁", async () => {
  const disposed = [];
  const cache = createResourceLeaseCache({
    load: async (value) => value,
    dispose: (value) => disposed.push(value),
    retainUnused: false
  });
  const lease = await cache.acquire("scene", "resource");
  lease.release();
  assert.deepEqual(disposed, ["resource"]);
});
