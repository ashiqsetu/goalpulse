// Leagues the app shows. Fixture lists are filtered to this whitelist.
//
// The data provider (football-data.org free plan) serves exactly these
// competitions. IDs are the legacy API-Football ids the app uses internally —
// the serverless proxy maps them to football-data.org competition codes.
//   39  Premier League (England)    140 La Liga (Spain)
//   135 Serie A (Italy)             78  Bundesliga (Germany)
//   61  Ligue 1 (France)            2   UEFA Champions League
//   88  Eredivisie (Netherlands)    94  Primeira Liga (Portugal)
//   40  Championship (England)      71  Brasileirão Série A (Brazil)
//   13  Copa Libertadores           1   FIFA World Cup
//   4   UEFA Euro
export const WANTED_LEAGUE_IDS = [
  39, 140, 135, 78, 61, // top-5 European leagues
  2,   // UEFA Champions League
  88, 94, // Eredivisie, Primeira Liga
  40,  // Championship
  71, 13, // Brasileirão, Copa Libertadores
  1, 4, // World Cup, Euro
]

export const isWantedLeague = (id) => WANTED_LEAGUE_IDS.includes(id)

// Display order for grouped fixture lists = array order above.
export const LEAGUE_ORDER = WANTED_LEAGUE_IDS
