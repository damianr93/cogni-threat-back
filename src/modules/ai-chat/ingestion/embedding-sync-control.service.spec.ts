import { EmbeddingSyncControlService } from './embedding-sync-control.service';

describe('EmbeddingSyncControlService', () => {
  it('blocks embedding work while manually paused and resumes when requested', async () => {
    const service = new EmbeddingSyncControlService();
    service.pauseManual();

    let released = false;
    const wait = service.waitIfPaused().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);
    expect(service.getStatus()).toMatchObject({
      paused: true,
      manualPaused: true,
      pauseReasons: ['manual'],
    });

    service.resumeManual();
    await wait;

    expect(released).toBe(true);
    expect(service.getStatus()).toMatchObject({
      paused: false,
      manualPaused: false,
      pauseReasons: [],
    });
  });

  it('pauses embedding work only while an interactive chat response is running', async () => {
    const service = new EmbeddingSyncControlService();
    const events: string[] = [];

    await service.runWithInteractivePriority(async () => {
      events.push('chat-started');
      expect(service.getStatus()).toMatchObject({
        paused: true,
        activeInteractiveRequests: 1,
        pauseReasons: ['chat'],
      });
      events.push('chat-finished');
      return 'ok';
    });

    expect(events).toEqual(['chat-started', 'chat-finished']);
    expect(service.getStatus()).toMatchObject({
      paused: false,
      activeInteractiveRequests: 0,
      pauseReasons: [],
    });
  });
});
