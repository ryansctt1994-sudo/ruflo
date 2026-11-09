/**
 * Tests for WASM Agent MCP Tools
 *
 * ADR-129: Validates all MCP tool handlers (10 original + 17 new P2/P3/P4).
 */

import { describe, it, expect, vi } from 'vitest';

// vitest.config.ts sets mockReset: true, which wipes .mockReturnValue() and
// .mockResolvedValue() before every test but restores an implementation
// passed to vi.fn(impl). These helpers bake the value into the
// implementation so module-level mocks survive the reset. As with
// mockReturnValue, the value is evaluated once, so identity is preserved.
const { returns, resolves } = vi.hoisted(() => ({
  returns: <T>(value: T) => vi.fn(() => value),
  resolves: <T>(value: T) => vi.fn(async () => value),
}));

// ── Mock the agent-wasm module ───────────────────────────────

const mockAgentInfo = {
  id: 'wasm-agent-1-test',
  state: 'idle' as const,
  config: {},
  model: 'test-model',
  turnCount: 0,
  fileCount: 0,
  isStopped: false,
  createdAt: '2026-03-17T00:00:00.000Z',
};

vi.mock('../src/ruvector/agent-wasm.js', () => ({
  isAgentWasmAvailable: resolves(true),
  initAgentWasm: resolves(undefined),
  createWasmAgent: resolves({ ...mockAgentInfo }),
  promptWasmAgent: resolves('Agent response'),
  executeWasmTool: resolves({ success: true, output: 'ok' }),
  getWasmAgent: returns({ ...mockAgentInfo }),
  listWasmAgents: returns([{ ...mockAgentInfo }]),
  terminateWasmAgent: returns(true),
  resetWasmAgent: returns(true),
  getWasmAgentState: returns({ messages: [], turn_count: 0 }),
  getWasmAgentTools: returns(['read_file', 'write_file']),
  getWasmAgentTodos: returns([]),
  exportWasmState: returns('{"state":"exported"}'),
  createWasmMcpServer: resolves(resolves('{}')),
  listGalleryTemplates: resolves([{ id: 'coder', name: 'Coder Agent' }]),
  getGalleryCount: resolves(6),
  getGalleryCategories: resolves({ development: 2 }),
  searchGalleryTemplates: resolves([{ id: 'coder', name: 'Coder Agent', relevance: 0.7 }]),
  getGalleryTemplate: resolves({ id: 'coder', prompts: [], tools: [], skills: [] }),
  createAgentFromTemplate: resolves({ ...mockAgentInfo, id: 'wasm-agent-2-tpl' }),
  buildRvfContainer: resolves(new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  buildRvfFromTemplate: resolves(new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  // ADR-129 P3 gallery CRUD
  galleryLoadRvf: resolves(new Uint8Array([0x52, 0x56, 0x46, 0x01])),
  galleryConfigure: resolves(undefined),
  galleryListByCategory: resolves([{ id: 'coder', name: 'Coder Agent' }]),
  galleryAddCustom: resolves(undefined),
  galleryRemoveCustom: resolves(undefined),
  galleryImportCustom: resolves(1),
  galleryExportCustom: resolves([{ id: 'custom-1' }]),
  galleryGetActive: resolves('coder'),
  galleryGetConfig: resolves({ maxTurns: 50 }),
}));

import { wasmAgentTools } from '../src/mcp-tools/wasm-agent-tools.js';

// ── Helper ───────────────────────────────────────────────────

function findTool(name: string) {
  const tool = wasmAgentTools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return findTool(name).handler(args);
}

function parseResult(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ── Tests ────────────────────────────────────────────────────

// This suite used to be skipped in CI on the theory that the real @ruvector/rvagent-wasm
// package still loaded and crashed without a built WASM binary. It does
// not: every test here passes with @ruvector/rvagent-wasm removed from node_modules.
// The failures came from mockReset wiping .mockReturnValue(); see the
// returns/resolves helpers at the top of this file.
describe('wasm-agent-tools MCP', () => {
  it('exports 27 tools (10 original + 17 new ADR-129 P2/P3/P4)', () => {
    expect(wasmAgentTools).toHaveLength(27);
  });

  it('all tools have required fields', () => {
    for (const tool of wasmAgentTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  describe('wasm_agent_create', () => {
    it('creates with config', async () => {
      const data = parseResult(await callTool('wasm_agent_create', { instructions: 'Test' }));
      expect(data.success).toBe(true);
      expect(data.agent.id).toBe('wasm-agent-1-test');
    });

    it('creates from template', async () => {
      const data = parseResult(await callTool('wasm_agent_create', { template: 'coder' }));
      expect(data.success).toBe(true);
      expect(data.source).toBe('gallery');
    });
  });

  it('wasm_agent_prompt returns response', async () => {
    const result = await callTool('wasm_agent_prompt', { agentId: 'test', input: 'Hello' });
    expect(result.content[0].text).toBe('Agent response');
  });

  it('wasm_agent_tool executes tool', async () => {
    const result = await callTool('wasm_agent_tool', { agentId: 'test', toolName: 'read_file', toolInput: { path: 'x' } });
    const text = result.content[0].text;
    expect(text).toContain('success');
  });

  it('wasm_agent_list lists agents', async () => {
    const data = parseResult(await callTool('wasm_agent_list'));
    expect(data.count).toBe(1);
  });

  it('wasm_agent_terminate terminates', async () => {
    const data = parseResult(await callTool('wasm_agent_terminate', { agentId: 'test' }));
    expect(data.success).toBe(true);
  });

  it('wasm_agent_files lists files', async () => {
    const result = await callTool('wasm_agent_files', { agentId: 'test' });
    expect(result.content[0].text).toContain('read_file');
  });

  it('wasm_agent_export exports state', async () => {
    const result = await callTool('wasm_agent_export', { agentId: 'test' });
    expect(result.content[0].text).toBe('{"state":"exported"}');
  });

  it('wasm_gallery_list lists templates', async () => {
    const data = parseResult(await callTool('wasm_gallery_list'));
    expect(data.count).toBe(1);
    expect(data.templates[0].id).toBe('coder');
  });

  it('wasm_gallery_search finds templates', async () => {
    const data = parseResult(await callTool('wasm_gallery_search', { query: 'code' }));
    expect(data.count).toBe(1);
  });

  it('wasm_gallery_create creates from template', async () => {
    const data = parseResult(await callTool('wasm_gallery_create', { template: 'coder' }));
    expect(data.success).toBe(true);
    expect(data.template).toBe('coder');
  });
});
