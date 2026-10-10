import { MatchStatsPanel, MatchStatsPanelEvents } from './MatchStatsPanel';

export type MatchStatsModalEvents = MatchStatsPanelEvents;
export class MatchStatsModal extends MatchStatsPanel {
  constructor(events: MatchStatsModalEvents = {}) {
    super(events);
  }
}
