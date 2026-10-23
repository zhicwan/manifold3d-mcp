import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CommittedModel, ModelingSession, RenderViewOptions, Report } from '@manifold3d/modeling/modeling.js';
import { MAX_CODE_BYTES } from '@manifold3d/modeling/validation/validators.js';

import type {
  DshAgent,
  DshContentBlock,
  DshHostPorts,
  DshImageBlock,
  DshToolDefinition,
  DshToolExecution,
} from './dsh-boundary.js';

const CAPTURE_VIEWS = new Set<NonNullable<RenderViewOptions['view']>>([
  'iso',
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
]);
const MAX_DESCRIPTION_LENGTH = 240;
export const CAPTURE_DIRECTORY = join('.manifold3d', 'captures');

export interface DshToolsOptions {
  ports: Pick<DshHostPorts, 'admitImage' | 'workingDirectory'>;
  /** The Session-owned modeling state for the calling Agent. */
  modelingFor(agent: DshAgent): ModelingSession;
  /** Existing modeling state, without creating it. */
  existingModelingFor(agent: DshAgent): ModelingSession | undefined;
  publishModel(agent: DshAgent, model: CommittedModel, source: string, description?: string): void;
}

/** A tool failure whose message is the model-facing JSON body. */
export class DshToolFailure extends Error {
  constructor(readonly body: Record<string, unknown>) {
    super(JSON.stringify(body));
    this.name = 'DshToolFailure';
  }
}

export function createDshTools(options: DshToolsOptions): DshToolDefinition[] {
  const capturedImages = new WeakMap<DshToolExecution, DshImageBlock>();
  return [
    {
      name: 'manifold_validate_script',
      description:
        'Validate a manifold-3d TypeScript snippet in the sandbox without changing the current Viewer model.',
      parameters: codeParameters(false),
      output: jsonOutput(),
      execute: async (args, exec) => {
        const input = parseCodeArgs(args, false);
        const result = await options.modelingFor(requireAgent(exec)).validate({ code: input.code });
        return reportValue(result.report);
      },
    },
    {
      name: 'manifold_execute_script',
      description:
        'Execute a manifold-3d TypeScript snippet and publish a successful model to every open Manifold 3D Viewer tab of this session.',
      parameters: codeParameters(true),
      output: jsonOutput(),
      execute: async (args, exec) => {
        const input = parseCodeArgs(args, true);
        const agent = requireAgent(exec);
        const result = await options.modelingFor(agent).execute(
          {
            code: input.code,
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
          {
            beforeCommit: model => options.publishModel(agent, model, input.code, input.description),
          },
        );
        return reportValue(result.report, result.model ? { modelRevision: result.model.revision } : {});
      },
    },
    {
      name: 'manifold_capture_view',
      description:
        'Render the current Manifold model of this session to a PNG and return it as an image (or a saved file path when the model cannot accept images).',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: [...CAPTURE_VIEWS], default: 'iso', description: 'Camera preset.' },
          width: { type: 'integer', minimum: 128, maximum: 2048, default: 1024 },
          height: { type: 'integer', minimum: 128, maximum: 2048, default: 1024 },
        },
        additionalProperties: false,
      },
      output: jsonOutput(),
      projectContent: (exec, result) => {
        const image = capturedImages.get(exec);
        capturedImages.delete(exec);
        if (!image || result.isError || !result.content) {
          return undefined;
        }
        return [...result.content, image];
      },
      execute: async (args, exec) => {
        const renderOptions = parseCaptureArgs(args);
        const agent = requireAgent(exec);
        const capture = await options.existingModelingFor(agent)?.captureCurrent(renderOptions);
        if (!capture) {
          throw new DshToolFailure({
            ok: false,
            code: 'NO_MODEL',
            message: 'No model is available to capture. Run manifold_execute_script successfully first.',
          });
        }
        const view = renderOptions.view ?? 'iso';
        const body = {
          ok: true,
          modelRevision: capture.model.revision,
          view,
          width: capture.result.width,
          height: capture.result.height,
          renderBackend: 'software-rasterizer',
        };
        const admitted = await options.ports.admitImage(exec, capture.result.png);
        if ('block' in admitted) {
          capturedImages.set(exec, admitted.block);
          return { ...body, image: 'attached' };
        }
        const directory = join(options.ports.workingDirectory(agent), CAPTURE_DIRECTORY);
        await mkdir(directory, { recursive: true });
        const filePath = join(directory, `capture-r${capture.model.revision}-${view}-${randomUUID()}.png`);
        await writeFile(filePath, capture.result.png, { flag: 'wx' });
        return { ...body, image: 'file', imageUnavailable: admitted.unavailable, filePath };
      },
    },
  ];
}

function requireAgent(exec: DshToolExecution): DshAgent {
  if (!exec.agent) {
    throw new DshToolFailure({
      ok: false,
      code: 'SESSION_UNAVAILABLE',
      message: 'Manifold tools require a calling DeepSeek Harness session.',
    });
  }
  return exec.agent;
}

function jsonOutput(): DshToolDefinition['output'] {
  return {
    schema: { type: 'object' },
    render: (_args, value): DshContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
  };
}

function codeParameters(withDescription: boolean): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        minLength: 1,
        description:
          'TypeScript source that assigns the final Manifold to `result`. Available globals: Manifold, CrossSection, Mesh.',
      },
      ...(withDescription
        ? {
            description: {
              type: 'string',
              maxLength: MAX_DESCRIPTION_LENGTH,
              description: 'Optional short label displayed by the Viewer.',
            },
          }
        : {}),
    },
    required: ['code'],
    additionalProperties: false,
  };
}

function parseCodeArgs(value: unknown, withDescription: boolean): { code: string; description?: string } {
  const record = exactRecord(value, withDescription ? ['code', 'description'] : ['code']);
  if (typeof record.code !== 'string' || record.code.length === 0) {
    throw invalid('INVALID_ARGUMENT', '`code` must be a non-empty string.');
  }
  if (Buffer.byteLength(record.code, 'utf8') > MAX_CODE_BYTES) {
    throw invalid('CODE_TOO_LARGE', `Source exceeds the ${MAX_CODE_BYTES} byte limit.`);
  }
  if (!withDescription || record.description === undefined) {
    return { code: record.code };
  }
  if (
    typeof record.description !== 'string' ||
    record.description.length === 0 ||
    record.description.length > MAX_DESCRIPTION_LENGTH ||
    hasUnsafeControlCharacter(record.description)
  ) {
    throw invalid(
      'INVALID_ARGUMENT',
      `\`description\` must be plain text no longer than ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return { code: record.code, description: record.description };
}

function parseCaptureArgs(value: unknown): RenderViewOptions {
  const record = exactRecord(value ?? {}, ['view', 'width', 'height']);
  const view = record.view ?? 'iso';
  if (typeof view !== 'string' || !CAPTURE_VIEWS.has(view as NonNullable<RenderViewOptions['view']>)) {
    throw invalid('INVALID_ARGUMENT', '`view` is not a supported camera preset.');
  }
  return {
    view: view as NonNullable<RenderViewOptions['view']>,
    width: boundedInteger(record.width ?? 1024, 'width'),
    height: boundedInteger(record.height ?? 1024, 'height'),
  };
}

function boundedInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 128 || value > 2048) {
    throw invalid('INVALID_ARGUMENT', `\`${label}\` must be an integer from 128 to 2048.`);
  }
  return value;
}

function exactRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('INVALID_ARGUMENT', 'Tool arguments must be an object.');
  }
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find(key => !allowedKeys.includes(key));
  if (unexpected !== undefined) {
    throw invalid('INVALID_ARGUMENT', `Tool arguments contain unsupported field \`${unexpected}\`.`);
  }
  return record;
}

/** Tool values must be lossless JSON: drop undefined fields deterministically. */
function reportValue(report: Report, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const body = JSON.parse(JSON.stringify({ ...report, ...extra })) as Record<string, unknown>;
  if (!report.ok) {
    throw new DshToolFailure(body);
  }
  return body;
}

function invalid(code: string, message: string): DshToolFailure {
  return new DshToolFailure({ ok: false, code, message });
}

function hasUnsafeControlCharacter(value: string): boolean {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}
