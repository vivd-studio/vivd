export function addClassName(node, className) {
  if (!node || typeof node !== "object") {
    return;
  }

  const properties =
    node.properties && typeof node.properties === "object"
      ? node.properties
      : (node.properties = {});

  const existing = properties.className;
  if (Array.isArray(existing)) {
    if (!existing.includes(className)) {
      existing.push(className);
    }
    return;
  }

  if (typeof existing === "string" && existing.length > 0) {
    const classNames = existing.split(/\s+/).filter(Boolean);
    if (!classNames.includes(className)) {
      classNames.push(className);
    }
    properties.className = classNames;
    return;
  }

  properties.className = [className];
}
