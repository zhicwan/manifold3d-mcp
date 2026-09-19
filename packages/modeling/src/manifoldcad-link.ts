import ts from 'typescript';

export const MANIFOLDCAD_SHARE_URL_LIMIT = 32_000;
const MANIFOLDCAD_URL = 'https://manifoldcad.org/';
const DEFAULT_SCRIPT_NAME = 'Manifold MCP Model';
const MAX_SCRIPT_NAME_LENGTH = 80;
const CODE_MARKER = '<code>';

const MANIFOLDCAD_VALUES = ['Manifold', 'CrossSection', 'Mesh'] as const;
const MANIFOLDCAD_TYPES: Record<string, { declaration: string; dependencies?: string[] }> = {
  Vec2: { declaration: 'type Vec2 = [number, number];' },
  Vec3: { declaration: 'type Vec3 = [number, number, number];' },
  Mat3: { declaration: 'type Mat3 = [number, number, number, number, number, number, number, number, number];' },
  Mat4: {
    declaration:
      'type Mat4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];',
  },
  Rect: { declaration: 'type Rect = { min: Vec2; max: Vec2 };', dependencies: ['Vec2'] },
  Box: { declaration: 'type Box = { min: Vec3; max: Vec3 };', dependencies: ['Vec3'] },
  SimplePolygon: { declaration: 'type SimplePolygon = Vec2[];', dependencies: ['Vec2'] },
  Polygons: {
    declaration: 'type Polygons = SimplePolygon | SimplePolygon[];',
    dependencies: ['SimplePolygon'],
  },
  FillRule: { declaration: "type FillRule = 'EvenOdd' | 'NonZero' | 'Positive' | 'Negative';" },
  JoinType: { declaration: "type JoinType = 'Square' | 'Round' | 'Miter';" },
  Smoothness: { declaration: 'type Smoothness = { halfedge: number; smoothness: number };' },
  RayHit: {
    declaration: 'type RayHit = { faceID: number; distance: number; position: Vec3; normal: Vec3 };',
    dependencies: ['Vec3'],
  },
  SealedUint32Array: {
    declaration: 'interface SealedUint32Array<N extends number> extends Uint32Array { readonly length: N; }',
  },
  SealedFloat32Array: {
    declaration: 'interface SealedFloat32Array<N extends number> extends Float32Array { readonly length: N; }',
  },
  ErrorStatus: {
    declaration:
      "type ErrorStatus = 'NoError' | 'NonFiniteVertex' | 'NotManifold' | 'VertexOutOfBounds' | 'PropertiesWrongLength' | 'MissingPositionProperties' | 'MergeVectorsDifferentLengths' | 'MergeIndexOutOfBounds' | 'TransformWrongLength' | 'RunIndexWrongLength' | 'FaceIDWrongLength' | 'InvalidConstruction' | 'ResultTooLarge' | 'InvalidTangents' | 'Cancelled';",
  },
  MeshOptions: {
    declaration:
      'interface MeshOptions { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array; mergeFromVert?: Uint32Array; mergeToVert?: Uint32Array; runIndex?: Uint32Array; runOriginalID?: Uint32Array; runTransform?: Float32Array; faceID?: Uint32Array; halfedgeTangent?: Float32Array; tolerance?: number; }',
  },
};

export type ManifoldCadLinkErrorCode = 'URL_TOO_LONG';

export class ManifoldCadLinkError extends Error {
  constructor(
    readonly code: ManifoldCadLinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManifoldCadLinkError';
  }
}

export interface ManifoldCadShareLink {
  name: string;
  source: string;
  url: string;
}

export function createManifoldCadShareLink({
  code,
  name,
  maxUrlLength = MANIFOLDCAD_SHARE_URL_LIMIT,
}: {
  code: string;
  name?: string;
  maxUrlLength?: number;
}): ManifoldCadShareLink {
  const normalizedName = normalizeScriptName(name);
  const source = createManifoldCadSource(code);
  const fragment = encodeURIComponent(`${normalizedName}${CODE_MARKER}${source}`);
  const url = `${MANIFOLDCAD_URL}#${fragment}`;
  if (url.length > maxUrlLength) {
    throw new ManifoldCadLinkError(
      'URL_TOO_LONG',
      `ManifoldCAD link is ${url.length.toLocaleString('en-US')} characters; the supported limit is ${maxUrlLength.toLocaleString('en-US')}.`,
    );
  }
  return { name: normalizedName, source, url };
}

export function createManifoldCadSource(code: string): string {
  const { sourceFile, checker } = createCheckedSource(code);
  const unresolvedNames = collectUnresolvedNames(sourceFile, checker);
  const declaresResult = sourceFile.statements.some(statement => {
    if (!ts.isVariableStatement(statement)) {
      return false;
    }
    return statement.declarationList.declarations.some(declaration => bindingContainsResult(declaration.name));
  });
  const importedValues = MANIFOLDCAD_VALUES.filter(
    name => unresolvedNames.has(name) || (name === 'Manifold' && !declaresResult),
  );
  const requiredTypes = resolveRequiredTypes(unresolvedNames);
  const unformatted = [
    ...(importedValues.length > 0 ? [`import { ${importedValues.join(', ')} } from 'manifold-3d/manifoldCAD';`] : []),
    ...requiredTypes.map(name => MANIFOLDCAD_TYPES[name]!.declaration),
    ...(declaresResult ? [] : ['', 'let result: Manifold;']),
    '',
    code.trimEnd(),
    '',
    'export default result;',
    '',
  ].join('\n');
  const moduleSource = ts.createSourceFile(
    'manifold-mcp-model.ts',
    unformatted,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(moduleSource);
}

function createCheckedSource(code: string): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  const fileName = '/manifold-mcp-model.ts';
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    noLib: true,
    noResolve: true,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = requested => requested === fileName;
  host.readFile = requested => (requested === fileName ? code : undefined);
  host.getSourceFile = (requested, languageVersion) =>
    requested === fileName ? ts.createSourceFile(fileName, code, languageVersion, true, ts.ScriptKind.TS) : undefined;
  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName)!;
  return { sourceFile, checker: program.getTypeChecker() };
}

function collectUnresolvedNames(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Set<string> {
  const unresolvedNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!symbol || !symbol.declarations || symbol.declarations.length === 0) {
        unresolvedNames.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return unresolvedNames;
}

function isReferenceIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertySignature(parent) && parent.name === identifier) ||
    (ts.isMethodSignature(parent) && parent.name === identifier)
  ) {
    return false;
  }
  return !(
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent)) &&
    parent.name === identifier
  );
}

function resolveRequiredTypes(referencedNames: Set<string>): string[] {
  const required = new Set<string>();
  const add = (name: string): void => {
    if (required.has(name)) {
      return;
    }
    const entry = MANIFOLDCAD_TYPES[name];
    if (!entry) {
      return;
    }
    for (const dependency of entry.dependencies ?? []) {
      add(dependency);
    }
    required.add(name);
  };
  for (const name of referencedNames) {
    add(name);
  }
  return [...required];
}

function bindingContainsResult(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) {
    return name.text === 'result';
  }
  return name.elements.some(element => !ts.isOmittedExpression(element) && bindingContainsResult(element.name));
}

function normalizeScriptName(name: string | undefined): string {
  const normalized = (name ?? '')
    .replace(/<code>/gi, 'code')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || DEFAULT_SCRIPT_NAME).slice(0, MAX_SCRIPT_NAME_LENGTH).trim() || DEFAULT_SCRIPT_NAME;
}
