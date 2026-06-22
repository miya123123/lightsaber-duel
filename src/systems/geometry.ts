export type Vec2 = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Segment = {
  a: Vec2;
  b: Vec2;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function closestPointOnSegment(point: Vec2, segment: Segment): Vec2 {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0.0001) {
    return { ...segment.a };
  }

  const t = clamp(((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared, 0, 1);
  return {
    x: segment.a.x + dx * t,
    y: segment.a.y + dy * t
  };
}

export function pointToSegmentDistance(point: Vec2, segment: Segment): number {
  return distance(point, closestPointOnSegment(point, segment));
}

export function segmentDistance(first: Segment, second: Segment): number {
  if (segmentsIntersect(first, second)) return 0;

  return Math.min(
    pointToSegmentDistance(first.a, second),
    pointToSegmentDistance(first.b, second),
    pointToSegmentDistance(second.a, first),
    pointToSegmentDistance(second.b, first)
  );
}

export function segmentContactPoint(first: Segment, second: Segment): Vec2 {
  const candidates = [
    { source: first.a, target: closestPointOnSegment(first.a, second) },
    { source: first.b, target: closestPointOnSegment(first.b, second) },
    { source: second.a, target: closestPointOnSegment(second.a, first) },
    { source: second.b, target: closestPointOnSegment(second.b, first) }
  ];
  const closest = candidates.reduce((best, candidate) =>
    distance(candidate.source, candidate.target) < distance(best.source, best.target) ? candidate : best
  );

  return {
    x: (closest.source.x + closest.target.x) / 2,
    y: (closest.source.y + closest.target.y) / 2
  };
}

export function rectContainsPoint(rect: Rect, point: Vec2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function rectCenter(rect: Rect): Vec2 {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

export function segmentIntersectsRect(segment: Segment, rect: Rect): boolean {
  if (rectContainsPoint(rect, segment.a) || rectContainsPoint(rect, segment.b)) {
    return true;
  }

  const top: Segment = { a: { x: rect.x, y: rect.y }, b: { x: rect.x + rect.width, y: rect.y } };
  const right: Segment = {
    a: { x: rect.x + rect.width, y: rect.y },
    b: { x: rect.x + rect.width, y: rect.y + rect.height }
  };
  const bottom: Segment = {
    a: { x: rect.x + rect.width, y: rect.y + rect.height },
    b: { x: rect.x, y: rect.y + rect.height }
  };
  const left: Segment = { a: { x: rect.x, y: rect.y + rect.height }, b: { x: rect.x, y: rect.y } };

  return [top, right, bottom, left].some((edge) => segmentsIntersect(segment, edge));
}

export function segmentsIntersect(first: Segment, second: Segment): boolean {
  const d1 = direction(second.a, second.b, first.a);
  const d2 = direction(second.a, second.b, first.b);
  const d3 = direction(first.a, first.b, second.a);
  const d4 = direction(first.a, first.b, second.b);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return (
    (d1 === 0 && onSegment(second.a, second.b, first.a)) ||
    (d2 === 0 && onSegment(second.a, second.b, first.b)) ||
    (d3 === 0 && onSegment(first.a, first.b, second.a)) ||
    (d4 === 0 && onSegment(first.a, first.b, second.b))
  );
}

function direction(a: Vec2, b: Vec2, c: Vec2): number {
  const value = (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value;
}

function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - 0.0001 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 0.0001 &&
    Math.min(a.y, b.y) - 0.0001 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 0.0001
  );
}
