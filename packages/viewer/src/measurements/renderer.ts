import * as THREE from 'three';
import type {
  MeasurementEvidence,
  MeasurementOperand,
  MeasurementVec3,
} from '@manifold3d/protocol/wire/measurements.js';
import type { MeasurementAnnotation } from '../marks/types.js';
import type { MeasurementCandidate } from './geometry.js';
import type { DimensionStroke, DepthPoint } from './projection.js';
import { SCENE_PALETTE } from '../scene/palette.js';

export class MeasurementRenderer {
  private readonly root = new THREE.Group();
  private readonly preview = new THREE.Group();
  private readonly results = new THREE.Group();
  private readonly dimensions = new Map<string, THREE.Group>();
  private theme: 'light' | 'dark' = 'light';

  constructor(
    scene: THREE.Scene,
    private readonly getMesh: () => THREE.Mesh | null,
  ) {
    this.root.name = 'measurement-overlay';
    this.root.add(this.preview, this.results);
    scene.add(this.root);
  }

  setPreview(
    a: MeasurementCandidate | null,
    b: MeasurementCandidate | null,
    evidence: MeasurementEvidence | null,
    faceCenter: MeasurementCandidate | null = null,
  ): void {
    clearGroup(this.preview);
    const color = SCENE_PALETTE[this.theme].spatial;
    if (a) {
      this.highlight(a, color, this.preview);
    }
    if (b && b.key !== a?.key) {
      this.highlight(b, color, this.preview);
    }
    if (evidence?.distance) {
      this.addWitnesses(this.preview, evidence, color, [...(a ? [a.operand] : []), ...(b ? [b.operand] : [])]);
    }
    if (faceCenter && faceCenter.key !== a?.key && faceCenter.key !== b?.key) {
      this.drawOperand(this.preview, faceCenter.operand, color);
    }
    this.applyMarkerPalette();
    this.updateTransform();
  }

  setResults(
    annotations: readonly MeasurementAnnotation[],
    expandedId: string | null,
    resolvePlane?: (triangleId: number) => MeasurementCandidate | null,
  ): void {
    clearGroup(this.results);
    for (const annotation of annotations) {
      const evidence = annotation.measurement;
      const color = SCENE_PALETTE[this.theme].spatial;
      if (evidence.distance) {
        this.addWitnesses(this.results, evidence, color, annotation.id === expandedId ? evidence.operands : []);
      }
      if (annotation.id === expandedId) {
        for (const operand of evidence.operands) {
          const plane = operand.kind === 'plane' ? resolvePlane?.(operand.triangleId) : null;
          if (plane) {
            this.highlight(plane, color, this.results);
          } else {
            this.drawOperand(this.results, operand, color);
          }
        }
      }
    }
    this.applyMarkerPalette();
    this.updateTransform();
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme;
    this.applyMarkerPalette();
  }

  private applyMarkerPalette(): void {
    for (const group of [this.preview, this.results]) {
      group.traverse(object => {
        if (
          (object instanceof THREE.Mesh || object instanceof THREE.Line) &&
          (object.material instanceof THREE.MeshStandardMaterial ||
            object.material instanceof THREE.MeshBasicMaterial ||
            object.material instanceof THREE.LineBasicMaterial)
        ) {
          object.material.color.setHex(SCENE_PALETTE[this.theme].spatial);
        }
      });
    }
  }

  setDimension(
    id: string,
    strokes: readonly DimensionStroke[],
    camera: THREE.Camera,
    width: number,
    height: number,
    color: string,
  ): void {
    const mesh = this.getMesh();
    if (!mesh || strokes.length === 0 || width <= 0 || height <= 0) {
      this.removeDimension(id);
      return;
    }
    mesh.updateWorldMatrix(true, false);
    const inverse = mesh.matrixWorld.clone().invert();
    const local = (point: DepthPoint) =>
      new THREE.Vector3((point.x / width) * 2 - 1, 1 - (point.y / height) * 2, point.depth)
        .unproject(camera)
        .applyMatrix4(inverse);
    let group = this.dimensions.get(id);
    if (!group) {
      group = new THREE.Group();
      group.name = `dimension:${id}`;
      this.dimensions.set(id, group);
      this.root.add(group);
    }
    let rendered = 0;
    for (const stroke of strokes) {
      const a = local(stroke.start);
      const b = local(stroke.end);
      const pixels = Math.hypot(stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y);
      if (pixels < 0.01) {
        continue;
      }
      const unit = a.distanceTo(b) / pixels;
      // Both passes use the model depth buffer, so a single line can switch
      // between solid and dashed at the occluder's exact screen silhouette.
      const visibleIndex = rendered * 2;
      const hiddenIndex = visibleIndex + 1;
      const visible: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> =
        group.children[visibleIndex] instanceof THREE.Line
          ? (group.children[visibleIndex] as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>)
          : createDimensionLine(false);
      const hidden: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial> =
        group.children[hiddenIndex] instanceof THREE.Line
          ? (group.children[hiddenIndex] as THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>)
          : createDimensionLine(true);
      if (visible.parent !== group) {
        group.add(visible);
      }
      if (hidden.parent !== group) {
        group.add(hidden);
      }
      setLinePoints(visible, a, b);
      setLinePoints(hidden, a, b);
      visible.material.color.set(color);
      hidden.material.color.set(color);
      hidden.material.dashSize = unit * 5;
      hidden.material.gapSize = unit * 4;
      hidden.computeLineDistances();
      rendered++;
    }
    while (group.children.length > rendered * 2) {
      const child = group.children.at(-1)!;
      disposeRenderable(child);
      child.removeFromParent();
    }
    if (rendered === 0) {
      this.removeDimension(id);
      return;
    }
    this.updateTransform();
  }

  removeDimension(id: string): void {
    const group = this.dimensions.get(id);
    if (group) {
      clearGroup(group);
      group.removeFromParent();
      this.dimensions.delete(id);
    }
  }

  updateTransform(): void {
    const mesh = this.getMesh();
    if (mesh) {
      mesh.updateWorldMatrix(true, false);
      this.root.matrix.copy(mesh.matrixWorld);
      this.root.matrixAutoUpdate = false;
    }
  }

  updateMarkers(camera: THREE.Camera, width: number, height: number): void {
    const mesh = this.getMesh();
    if (!mesh || width <= 0 || height <= 0) {
      return;
    }
    const inverse = mesh.matrixWorld.clone().invert();
    this.root.traverse(object => {
      if (object instanceof SnapPointMarker) {
        object.updateProjection(camera, mesh.matrixWorld, inverse, width);
      }
    });
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }
  clear(): void {
    clearGroup(this.preview);
    clearGroup(this.results);
    for (const id of this.dimensions.keys()) {
      this.removeDimension(id);
    }
  }
  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  private highlight(candidate: MeasurementCandidate, color: number, parent: THREE.Group): void {
    this.drawOperand(parent, candidate.operand, color);
    if (candidate.operand.kind !== 'plane') {
      return;
    }
    const geometry = this.getMesh()?.geometry;
    const positions = geometry?.getAttribute('position');
    const index = geometry?.getIndex();
    if (!positions || !index) {
      return;
    }
    const values: number[] = [];
    for (const tri of candidate.triIds) {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = index.getX(tri * 3 + corner);
        values.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
      }
    }
    const overlayGeometry = new THREE.BufferGeometry();
    overlayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
    const overlay = new THREE.Mesh(
      overlayGeometry,
      new THREE.MeshBasicMaterial({
        color,
        opacity: 0.22,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    overlay.renderOrder = 990;
    parent.add(overlay);
  }

  private drawOperand(group: THREE.Group, operand: MeasurementOperand, color: number): void {
    if (operand.kind === 'edge') {
      addSegment(group, operand.start, operand.end, color);
    } else if (operand.kind === 'point') {
      addPoints(group, [operand.position], color);
    }
  }

  private addWitnesses(
    group: THREE.Group,
    evidence: MeasurementEvidence,
    color: number,
    highlighted: readonly MeasurementOperand[] = [],
  ): void {
    if (!evidence.distance) {
      return;
    }
    for (const position of [evidence.distance.start, evidence.distance.end]) {
      const matches = (point: MeasurementVec3) => point.every((value, index) => value === position[index]);
      if (
        highlighted.some(operand =>
          operand.kind === 'point'
            ? matches(operand.position)
            : operand.kind === 'edge' && (matches(operand.start) || matches(operand.end)),
        )
      ) {
        continue;
      }
      const center = evidence.operands.find(
        operand =>
          operand.kind === 'point' &&
          operand.faceCenter &&
          operand.position.every((value, index) => value === position[index]),
      );
      if (center) {
        this.drawOperand(group, center, color);
      } else {
        addPoints(group, [position], color);
      }
    }
  }
}

function addSegment(group: THREE.Group, a: MeasurementVec3, b: MeasurementVec3, color: number): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const material = new THREE.LineBasicMaterial({ color, depthTest: true, depthWrite: false });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 991;
  group.add(line);
  addPoints(group, [a, b], color);
}

function addPoints(group: THREE.Group, points: MeasurementVec3[], color: number): void {
  for (const point of points) {
    group.add(new SnapPointMarker(point, color));
  }
}

function createDimensionLine(dashed: false): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
function createDimensionLine(dashed: true): THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
function createDimensionLine(
  dashed: boolean,
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial | THREE.LineDashedMaterial> {
  const material = dashed
    ? new THREE.LineDashedMaterial({
        depthTest: true,
        depthWrite: false,
        depthFunc: THREE.GreaterDepth,
        transparent: true,
        opacity: 0.5,
      })
    : new THREE.LineBasicMaterial({
        depthTest: true,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
      });
  const line = new THREE.Line(new THREE.BufferGeometry(), material);
  line.renderOrder = dashed ? 995 : 994;
  return line;
}

function setLinePoints(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3): void {
  const positions = line.geometry.getAttribute('position');
  if (positions instanceof THREE.BufferAttribute && positions.count === 2) {
    positions.setXYZ(0, a.x, a.y, a.z);
    positions.setXYZ(1, b.x, b.y, b.z);
    positions.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    return;
  }
  line.geometry.setFromPoints([a, b]);
}

class SnapPointMarker extends THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> {
  private readonly center: THREE.Vector3;

  constructor(point: MeasurementVec3, color: number) {
    super(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        metalness: 0,
        transparent: true,
        opacity: 0.75,
        depthTest: true,
        depthWrite: false,
      }),
    );
    this.center = new THREE.Vector3(...point);
    this.name = 'measurement-point';
    this.renderOrder = 992;
    this.matrixAutoUpdate = false;
    this.frustumCulled = false;
    this.visible = false;
  }

  updateProjection(camera: THREE.Camera, model: THREE.Matrix4, inverse: THREE.Matrix4, width: number): void {
    const world = this.center.clone().applyMatrix4(model);
    const projected = world.clone().project(camera);
    this.visible = projected.z >= -1 && projected.z <= 1;
    if (!this.visible) {
      return;
    }
    const beside = projected
      .clone()
      .add(new THREE.Vector3(7 / width, 0, 0))
      .unproject(camera);
    const radius = world.distanceTo(beside);
    this.matrix.copy(inverse).multiply(new THREE.Matrix4().makeScale(radius, radius, radius).setPosition(world));
  }
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.traverse(object => {
      disposeRenderable(object);
    });
    child.removeFromParent();
  }
}

function disposeRenderable(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.dispose();
    }
  }
}
