// 엔진 독립 내보내기: Unity/Unreal/Godot 임포터가 읽을 수 있는 JSON 스키마.
// 좌표계: 미터, Y-up, 원점 = 섬 중심. rot = Y축 회전(라디안). y = 바닥 높이(중심 아님).
import { RULES } from './config.js';

export function exportWorld(ctx) {
  const round = (v) => Math.round(v * 100) / 100;
  return {
    schema: 'academy-city/1',
    seed: ctx.seed,
    units: 'meters, Y-up, rot=yaw radians, y=base height',
    districts: ctx.districts.map((d) => ({ id: d.id, type: d.type, name: d.name, seed: [round(d.x), round(d.z)], color: d.color })),
    landmarks: ctx.landmarks,
    roads: ctx.roadLines.filter((l) => !l.removed).map((l) => ({ id: l.id, level: l.level, width: l.width, sidewalk: l.sidewalk, covered: !!l.covered, pts: l.pts.map((p) => [round(p.x), round(p.z)]) })),
    nodes: ctx.nodes.map((n) => ({ x: round(n.x), z: round(n.z), level: n.level, lines: n.lines })),
    entities: ctx.entities.filter((e) => !e.deleted).map((e) => ({
      id: e.id, shape: e.shape, kind: e.kind, cat: e.cat, x: round(e.x), y: round(e.y), z: round(e.z), w: round(e.w), h: round(e.h), d: round(e.d),
      rot: round(e.rot || 0), rx: e.rx ? round(e.rx) : undefined, rz: e.rz ? round(e.rz) : undefined, color: e.color, solid: !!e.solid, rule: e.rule, name: e.name, why: e.why,
    })),
    pois: ctx.pois.filter((p) => !p.deleted),
    secrets: ctx.secrets.map((s) => ({ ...s })),
    decals: ctx.decals,
    routes: ctx.routes,
    rail: ctx.rail ? { stations: ctx.rail.stations.map((s) => ({ name: s.name, x: round(s.x), z: round(s.z) })), lines: ctx.rail.lines } : null,
    rules: RULES,
    metrics: ctx.metrics,
  };
}
