const DEFAULT_MIN_CONTACTS = 2;

export function createVehicleContactPoints({
  position,
  heading,
  halfWidth,
  halfLength
}) {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  const contacts = [];

  for (const longitudinal of [-halfLength, halfLength]) {
    for (const lateral of [-halfWidth, halfWidth]) {
      contacts.push(Object.freeze({
        x: position.x + rightX * lateral + forwardX * longitudinal,
        z: position.z + rightZ * lateral + forwardZ * longitudinal,
        lateral,
        longitudinal
      }));
    }
  }

  return Object.freeze(contacts);
}

export function resolveVehicleSupport({
  contactPoints,
  sampleSurface,
  minContacts = DEFAULT_MIN_CONTACTS
}) {
  const contacts = contactPoints
    .map((point) => {
      const surface = sampleSurface(point);
      if (!surface || !Number.isFinite(surface.height)) return null;
      return Object.freeze({ ...point, ...surface });
    })
    .filter(Boolean);

  if (contacts.length < minContacts) {
    return Object.freeze({
      grounded: false,
      contactCount: contacts.length,
      height: null,
      pitch: 0,
      roll: 0,
      surfaceId: null,
      contacts: Object.freeze(contacts)
    });
  }

  const front = averageBySide(contacts, "longitudinal", 1);
  const rear = averageBySide(contacts, "longitudinal", -1);
  const right = averageBySide(contacts, "lateral", 1);
  const left = averageBySide(contacts, "lateral", -1);
  const longitudinalSpan = Math.max(0.0001, front.coordinate - rear.coordinate);
  const lateralSpan = Math.max(0.0001, right.coordinate - left.coordinate);
  const surfaceCounts = new Map();

  for (const contact of contacts) {
    const surfaceId = contact.surfaceId ?? "surface";
    surfaceCounts.set(surfaceId, (surfaceCounts.get(surfaceId) ?? 0) + 1);
  }

  const surfaceId = [...surfaceCounts.entries()]
    .sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])[0]?.[0] ?? "surface";

  return Object.freeze({
    grounded: true,
    contactCount: contacts.length,
    height: contacts.reduce((sum, contact) => sum + contact.height, 0) / contacts.length,
    // Three.js cars point along local +Z. A rising front therefore needs negative X rotation.
    pitch: -Math.atan2(front.height - rear.height, longitudinalSpan),
    roll: Math.atan2(right.height - left.height, lateralSpan),
    surfaceId,
    contacts: Object.freeze(contacts)
  });
}

function averageBySide(contacts, coordinateKey, sign) {
  const side = contacts.filter((contact) => Math.sign(contact[coordinateKey]) === sign);
  const source = side.length ? side : contacts;
  return {
    coordinate: source.reduce((sum, contact) => sum + contact[coordinateKey], 0) / source.length,
    height: source.reduce((sum, contact) => sum + contact.height, 0) / source.length
  };
}
