import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(repoRoot, 'examples', 'mcp-server.mjs');

function startServer() {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      COOO_RPC_URL: 'http://127.0.0.1:9/lyquid/api',
      COOO_INFO_URL: 'http://127.0.0.1:9/lyquid/info',
      COOO_STATE_URL: 'http://127.0.0.1:9/api/state',
      COOO_TIMEOUT_MS: '2000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.on('error', () => {
    // The process may have already exited during teardown.
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // stdout must carry protocol lines only: any non-JSON line is a violation.
        assert.fail(`non-protocol line on stdout: ${JSON.stringify(line.slice(0, 200))}`);
      }

      if (message && message.id != null && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });

  child.on('exit', (code, signal) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`server exited code=${code} signal=${signal}; stderr=${stderr}`));
    }
    pending.clear();
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method} id=${id}; stderr=${stderr}`));
      }, 3000);

      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  function stop() {
    return new Promise((resolve) => {
      if (child.exitCode != null) {
        resolve();
        return;
      }
      child.once('exit', resolve);
      child.kill('SIGKILL');
    });
  }

  return { request, notify, stop, stderr: () => stderr };
}

test('cooo MCP server', async (t) => {
  const server = startServer();

  try {
    await t.test('initialize returns server info and capabilities', async () => {
      const response = await server.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });

      assert.equal(response.result.serverInfo.name, 'cooo-mcp');
      assert.equal(typeof response.result.capabilities.tools, 'object');
      // The requested protocol version must be echoed verbatim.
      assert.equal(response.result.protocolVersion, '2025-03-26');
    });

    await t.test('tools/list exposes tools after initialized notification', async () => {
      server.notify('notifications/initialized');
      const response = await server.request('tools/list');
      const tools = response.result.tools;

      assert.ok(Array.isArray(tools));
      // Pin the exact tool set: additions are fine, silent removals are not.
      const expectedTools = [
        'cooo_accept', 'cooo_allocate_child', 'cooo_assign_verifier', 'cooo_cancel',
        'cooo_create_reviewed_task', 'cooo_create_task', 'cooo_deliver', 'cooo_deposit',
        'cooo_discover', 'cooo_dispatch', 'cooo_get_state', 'cooo_grant_authority',
        'cooo_list_tasks', 'cooo_revoke_reviewer', 'cooo_sha256_text',
        'cooo_submit_verifier_result', 'cooo_task_detail', 'cooo_wait_for_state',
        'cooo_withdraw', 'cooo_withdraw_verifier_reward',
      ];
      const missing = expectedTools.filter((name) => !tools.some((t) => t.name === name));
      assert.deepEqual(missing, [], `tools missing from tools/list: ${missing.join(', ')}`);

      const getState = tools.find((tool) => tool.name === 'cooo_get_state');
      assert.ok(getState);
      assert.equal(getState.inputSchema.type, 'object');

      const dispatch = tools.find((tool) => tool.name === 'cooo_dispatch');
      assert.ok(dispatch);
      assert.ok(dispatch.inputSchema.required.includes('taskId'));
    });

    await t.test('dead endpoint returns an isError tool result', async () => {
      const response = await server.request('tools/call', {
        name: 'cooo_get_state',
        arguments: {},
      });

      assert.equal(response.result.isError, true);
      assert.equal(response.result.content[0].type, 'text');
    });

    await t.test('sha256 helper returns the expected digest', async () => {
      const response = await server.request('tools/call', {
        name: 'cooo_sha256_text',
        arguments: { text: 'id,value\n1,100\n2,200\n' },
      });

      assert.notEqual(response.result.isError, true);
      const value = JSON.parse(response.result.content[0].text);
      assert.equal(
        value.digest,
        '0x87325f7100f7e2257562b497c4db44b8fd4596f681ee18b16c6deb070669abe4',
      );
    });

    await t.test('missing required argument becomes an isError result', async () => {
      const response = await server.request('tools/call', {
        name: 'cooo_dispatch',
        arguments: {},
      });

      assert.equal(response.result.isError, true);
      assert.match(response.result.content[0].text, /missing required argument/);
    });

    await t.test('unknown tool is a JSON-RPC invalid params error', async () => {
      const response = await server.request('tools/call', {
        name: 'cooo_does_not_exist',
        arguments: {},
      });

      assert.equal(response.error.code, -32602);
      assert.match(response.error.message, /unknown tool/);
    });

    await t.test('unknown method is a JSON-RPC method not found error', async () => {
      const response = await server.request('foo/bar', {});

      assert.equal(response.error.code, -32601);
    });

    await t.test('server remains alive and answers ping', async () => {
      const response = await server.request('ping');
      assert.deepEqual(response.result, {});
    });
  } finally {
    await server.stop();
  }
});
