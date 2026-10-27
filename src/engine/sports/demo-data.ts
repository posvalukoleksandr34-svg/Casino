/**
 * Fictional demo competitions and teams. Every name here is invented for this
 * site; the ratings are arbitrary model inputs, not statistics of any real
 * club. Demo fixtures are always labelled as demo in the interface.
 */
export interface DemoTeam {
  id: string;
  name: string;
  shortName: string;
  /** Attack and defence multipliers ×1000 (defence > 1000 concedes more). */
  attackE3: number;
  defenceE3: number;
}

export interface DemoCompetition {
  id: string;
  name: string;
  teams: string[];
}

export const DEMO_TEAMS: DemoTeam[] = [
  { id: 'demo-aldmere', name: 'Aldmere Rovers', shortName: 'ALD', attackE3: 1250, defenceE3: 820 },
  { id: 'demo-brindlecourt', name: 'Brindlecourt FC', shortName: 'BRI', attackE3: 1120, defenceE3: 900 },
  { id: 'demo-calverholt', name: 'Calverholt United', shortName: 'CAL', attackE3: 1040, defenceE3: 980 },
  { id: 'demo-dunmarrow', name: 'Dunmarrow Athletic', shortName: 'DUN', attackE3: 960, defenceE3: 1030 },
  { id: 'demo-eskwater', name: 'Eskwater Town', shortName: 'ESK', attackE3: 900, defenceE3: 1080 },
  { id: 'demo-fenwhistle', name: 'Fenwhistle City', shortName: 'FEN', attackE3: 820, defenceE3: 1160 },
  { id: 'demo-glimmerford', name: 'Glimmerford Wanderers', shortName: 'GLI', attackE3: 1180, defenceE3: 860 },
  { id: 'demo-hollowmere', name: 'Hollowmere Albion', shortName: 'HOL', attackE3: 1010, defenceE3: 1000 },
  { id: 'demo-ironvale', name: 'Ironvale Rangers', shortName: 'IRO', attackE3: 1080, defenceE3: 950 },
  { id: 'demo-juniper-bay', name: 'Juniper Bay FC', shortName: 'JUN', attackE3: 930, defenceE3: 1050 },
  { id: 'demo-kestrelmoor', name: 'Kestrelmoor Town', shortName: 'KES', attackE3: 870, defenceE3: 1110 },
  { id: 'demo-larkspur', name: 'Larkspur Heath', shortName: 'LAR', attackE3: 990, defenceE3: 1010 },
];

export const DEMO_COMPETITIONS: DemoCompetition[] = [
  {
    id: 'demo-premier-division',
    name: 'Demo Premier Division',
    teams: ['demo-aldmere', 'demo-brindlecourt', 'demo-calverholt', 'demo-dunmarrow', 'demo-eskwater', 'demo-fenwhistle'],
  },
  {
    id: 'demo-coastal-league',
    name: 'Demo Coastal League',
    teams: ['demo-glimmerford', 'demo-hollowmere', 'demo-ironvale', 'demo-juniper-bay', 'demo-kestrelmoor', 'demo-larkspur'],
  },
];

/** League-average expected goals ×1000 for the home and away side. */
export const DEMO_BASE_HOME_E3 = 1450;
export const DEMO_BASE_AWAY_E3 = 1150;

export function demoTeam(id: string): DemoTeam {
  const t = DEMO_TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown demo team ${id}`);
  return t;
}

/** Expected goals ×1000 for a demo fixture (home attack × away defence × base). */
export function demoExpectedGoals(homeId: string, awayId: string): { homeE3: number; awayE3: number } {
  const h = demoTeam(homeId);
  const a = demoTeam(awayId);
  return {
    homeE3: Math.round((DEMO_BASE_HOME_E3 * h.attackE3 * a.defenceE3) / 1_000_000),
    awayE3: Math.round((DEMO_BASE_AWAY_E3 * a.attackE3 * h.defenceE3) / 1_000_000),
  };
}
