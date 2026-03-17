export class EventBuffer<T extends { eventId: string }> {
  private items: T[] = [];

  constructor(private readonly maxSize = 1000) {}

  append(item: T): void {
    this.items.push(item);
    const overflow = this.items.length - this.maxSize;
    if (overflow > 0) {
      this.items.splice(0, overflow);
    }
  }

  snapshot(lastEventId?: string): T[] {
    if (!lastEventId) return [...this.items];

    const lastIndex = this.items.findIndex((item) => item.eventId === lastEventId);
    if (lastIndex < 0) return [...this.items];

    return this.items.slice(lastIndex + 1);
  }

  clear(): void {
    this.items = [];
  }
}
