// Target companies. Run with: npx tsx seed/companies.ts
//
// board_token is the slug in the careers URL:
//   Greenhouse  job-boards.greenhouse.io/<token>        -> ats 'greenhouse'
//   Lever       jobs.lever.co/<token>  (case sensitive) -> ats 'lever'
//   Workable    apply.workable.com/<token>              -> ats 'workable'
// Workday and in-house portals stay manual-entry: leave ats 'workday' or 'other'
// and board_token null, and discovery will skip them.
//
// Tokens marked "[token unverified]" were added by research but NOT confirmed
// by a live endpoint call — validate before first discovery run.
//
// is_target: true  = declared target (will be highlighted / auto-qualified at lower score)
// is_target: false = board found, not yet decided to apply
//
// Priority ordering within each section:
//   1. Companies with a known direct-email contact → highest is_target weight
//   2. Companies with an active Greenhouse/Lever/Workable board (auto-discoverable)
//   3. Workday / own-portal companies (manual entry required)

import { pool } from "../lib/db";

type SeedCompany = {
  name: string;
  website?: string;
  ats?: "greenhouse" | "lever" | "workable" | "workday" | "other";
  board_token?: string;
  city?: string;
  is_target?: boolean;
  notes?: string;
};

const companies: SeedCompany[] = [
  // ─── ORIGINAL CONFIRMED TARGETS ──────────────────────────────────────────

  {
    name: "Genetec",
    website: "https://www.genetec.com",
    ats: "workable",
    board_token: "genetec-inc",
    city: "Saint-Laurent",
    is_target: true,
    notes: "Winter internship posting is a single catch-all req, department 'Internship'.",
  },
  {
    name: "Coveo",
    website: "https://www.coveo.com",
    ats: "greenhouse",
    board_token: "coveoen",
    city: "Montréal",
    is_target: true,
  },
  {
    name: "CAE",
    website: "https://www.cae.com",
    ats: "workday",
    city: "Saint-Laurent",
    is_target: true,
    notes: "Workday (wd3.myworkdayjobs.com). Manual entry, by hand and on purpose.",
  },

  // ─── BOARDS FOUND WHILE TRIAGING (not yet targets) ───────────────────────

  {
    name: "AlayaCare",
    website: "https://www.alayacare.com",
    ats: "greenhouse",
    board_token: "alayacare",
    city: "Montréal",
    is_target: false,
  },
  {
    name: "Poka",
    website: "https://www.poka.io",
    ats: "greenhouse",
    board_token: "poka",
    city: "Québec",
    is_target: false,
  },
  {
    name: "Workleap",
    website: "https://www.workleap.com",
    ats: "greenhouse",
    board_token: "workleap",
    city: "Québec",
    is_target: false,
  },
  {
    name: "Hivestack",
    website: "https://www.hivestack.com",
    ats: "greenhouse",
    board_token: "hivestack",
    city: "Montréal",
    is_target: false,
    notes: "Board is live but empty.",
  },
  {
    name: "Spiria",
    website: "https://www.spiria.com",
    ats: "lever",
    board_token: "spiria",
    city: "Montréal",
    is_target: false,
  },
  {
    name: "Osedea",
    website: "https://www.osedea.com",
    ats: "lever",
    board_token: "osedea",
    city: "Montréal",
    is_target: false,
  },
  {
    name: "Plusgrade",
    website: "https://www.plusgrade.com",
    ats: "lever",
    board_token: "plusgrade",
    city: "Montréal",
    is_target: false,
    notes: "Board is live but empty.",
  },
  {
    name: "Mistplay",
    website: "https://www.mistplay.com",
    ats: "lever",
    board_token: "mistplay",
    city: "Toronto",
    is_target: false,
    notes: "Toronto, kept for the board only.",
  },

  // ─── ORIGINAL PRIORITY EMPLOYERS (no board, highlighted via LinkedIn/Indeed) ─

  { name: "Hydro-Québec", city: "Montréal", is_target: true },
  { name: "Bombardier", city: "Montréal", is_target: true },
  { name: "Desjardins", city: "Lévis", is_target: true },
  { name: "RBC", city: "Montréal", is_target: true },
  { name: "TD", city: "Montréal", is_target: true },
  { name: "BMO", city: "Montréal", is_target: true },
  { name: "Scotiabank", city: "Montréal", is_target: true },
  { name: "National Bank of Canada", city: "Montréal", is_target: true },
  { name: "CIBC", city: "Montréal", is_target: true },
  { name: "Bell", city: "Montréal", is_target: true },
  { name: "CGI", city: "Montréal", is_target: true },
  { name: "Ericsson", city: "Montréal", is_target: true },
  { name: "Ubisoft", city: "Montréal", is_target: true },
  { name: "SAP", city: "Montréal", is_target: true },
  { name: "Morgan Stanley", city: "Montréal", is_target: true },

  // ════════════════════════════════════════════════════════════════════════════
  // GAME DEVELOPMENT – Montréal & surrounding region
  // Priority: ★ direct email contact  ★ active board  ○ manual/portal only
  // ════════════════════════════════════════════════════════════════════════════

  // ── Tier 1: large studios with active intern programs ─────────────────────

  {
    name: "Behaviour Interactive",
    website: "https://www.bhvr.com",
    ats: "greenhouse",
    board_token: "bhvr",
    city: "Montréal",
    is_target: true,
    notes:
      "Dead by Daylight studio. Greenhouse board posts intern roles every fall for winter/summer terms. [token unverified — validate before first run]",
  },
  {
    name: "Eidos-Montréal",
    website: "https://www.eidosmontreal.com",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Square Enix Canada (Deus Ex, Guardians of the Galaxy). Workday – manual entry. Direct recruiting: recrutement@eidosmontreal.com",
  },
  {
    name: "Ludia",
    website: "https://www.ludia.com",
    ats: "greenhouse",
    board_token: "ludia",
    city: "Montréal",
    is_target: true,
    notes:
      "Jam City subsidiary (Jurassic World Alive, D&D). Greenhouse board; intern program active winter & summer. [token unverified]",
  },
  {
    name: "WB Games Montréal",
    website: "https://www.wbgamesmontreal.com",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Warner Bros. Games – Batman Arkham Origins, Suicide Squad: Kill the Justice League. Workday portal – manual entry required.",
  },
  {
    name: "Keywords Studios – Montréal",
    website: "https://www.keywordsstudios.com",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "AAA game services (QA, art, audio, localisation). High intern volume. Workday: keywordsstudios.wd3.myworkdayjobs.com. Many openings posted daily.",
  },
  {
    name: "Unity Technologies",
    website: "https://unity.com",
    ats: "greenhouse",
    board_token: "unity",
    city: "Montréal",
    is_target: true,
    notes:
      "Game engine company with Montréal R&D office. Greenhouse board – filter 'Intern' + 'Montreal'. Roles in runtime, graphics, ML. [token unverified]",
  },
  {
    name: "Gameloft",
    website: "https://www.gameloft.com",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "Global mobile game publisher, Montréal HQ. Apply: gameloft.com/en/careers. Internships in game programming, QA, design.",
  },

  // ── Direct email contact – highest outreach priority ──────────────────────

  {
    name: "Red Barrels",
    website: "https://www.redbarrelsgames.com",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ Outlast series. Boutique horror studio. Send CV directly: jobs@redbarrelsgames.com",
  },
  {
    name: "Panache Digital Games",
    website: "https://www.panachedigitalgames.com",
    ats: "other",
    city: "Longueuil",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ Patrice Désilets' studio (Ancestors: The Humankind Odyssey). Small team; direct: jobs@panachedigitalgames.com",
  },
  {
    name: "Borealys Games",
    website: "https://www.borealys.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "★ DIRECT EMAIL ★ Indie (Mages of Mystralia). Very small; direct: contact@borealys.com",
  },

  // ── Active boards (auto-discoverable) ────────────────────────────────────

  {
    name: "Moment Factory",
    website: "https://www.momentfactory.com",
    ats: "lever",
    board_token: "momentfactory",
    city: "Montréal",
    is_target: true,
    notes:
      "Multimedia & immersive entertainment (Illumination, theme parks, concerts). Lever board; tech & creative intern roles. [token unverified]",
  },

  // ── Smaller / manual entry studios ───────────────────────────────────────

  {
    name: "Reflector Entertainment",
    website: "https://www.reflector.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Bandai Namco affiliate (Unknown Past). Small studio. Apply: reflector.com/careers.",
  },
  {
    name: "Compulsion Games",
    website: "https://compulsiongames.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Xbox Game Studios (We Happy Few, South of Midnight). Small team; check compulsiongames.com/jobs.",
  },
  {
    name: "Cradle Games",
    website: "https://www.cradlegames.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "Hellpoint. Small indie; apply via website contact form.",
  },
  {
    name: "Minority Media",
    website: "http://www.minoritymedia.net",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "Papo & Yo. Award-winning indie. Direct contact via website form.",
  },
  {
    name: "Larian Studios",
    website: "https://larian.com",
    ats: "other",
    city: "Remote / Québec",
    is_target: false,
    notes:
      "Baldur's Gate 3 (Belgian studio). Remote-friendly roles open to Canada. larian.com/jobs.",
  },
  {
    name: "Bkom Studios",
    website: "https://www.bkom.ca",
    ats: "other",
    city: "Québec",
    is_target: false,
    notes:
      "AAA co-dev & serious games studio (Québec City, ~2 h from Montréal). Apply via bkom.ca/careers.",
  },
  {
    name: "Hibernum Creations",
    website: "https://www.gearboxsoftware.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Now Gearbox Studio Montréal (acquired). Follow Gearbox job board for Montreal roles.",
  },

  // ════════════════════════════════════════════════════════════════════════════
  // BANKS & FINANCIAL INSTITUTIONS – additional Montréal employers
  // ════════════════════════════════════════════════════════════════════════════

  {
    name: "Laurentian Bank",
    website: "https://www.laurentianbank.ca",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Banque Laurentienne – Montréal-HQ'd bank. Active co-op/intern program in tech & IT. careers.laurentianbank.ca",
  },
  {
    name: "Sun Life Financial",
    website: "https://www.sunlife.com",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Insurance/wealth HQ'd in Montréal. Large tech org (digital, AI). Intern offers open annually Jan–Feb. Workday portal.",
  },
  {
    name: "Intact Financial Corporation",
    website: "https://www.intactfc.com",
    ats: "greenhouse",
    board_token: "intactfc",
    city: "Montréal",
    is_target: true,
    notes:
      "Canada's largest P&C insurer. Regular tech intern postings for winter & summer. [token unverified — may be 'intact']",
  },
  {
    name: "Barclays – Montréal Technology Centre",
    website: "https://search.jobs.barclays",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "2 000+ employee tech centre. Summer analyst & tech intern programs. search.jobs.barclays – filter Canada / Montréal.",
  },
  {
    name: "JPMorgan Chase – Montréal",
    website: "https://careers.jpmorgan.com",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Technology hub. SWE intern program posted Sep–Nov. careers.jpmorgan.com – search 'Montreal intern'.",
  },
  {
    name: "CDPQ",
    website: "https://www.cdpq.com",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "Caisse de dépôt et placement du Québec – largest Québec pension fund. Intern program in tech, data, quant. cdpq.com/en/careers",
  },
  {
    name: "iA Financial Group",
    website: "https://ia.ca",
    ats: "other",
    city: "Québec",
    is_target: true,
    notes:
      "iA Groupe financier – major insurer/bank. Active co-op program in IT & actuarial. careers.ia.ca",
  },
  {
    name: "Nuvei",
    website: "https://www.nuvei.com",
    ats: "greenhouse",
    board_token: "nuvei",
    city: "Montréal",
    is_target: true,
    notes:
      "Global payments platform (TSX). Active Greenhouse board; tech intern hiring in backend & platform. [token unverified]",
  },
  {
    name: "Fiera Capital",
    website: "https://www.fieracapital.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Asset manager. Occasional quant & tech intern postings. fieracapital.com/en/about/careers",
  },
  {
    name: "Power Corporation of Canada",
    website: "https://www.powercorporation.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Conglomerate (Great-West, IGM Financial). Corporate IT/data roles. powercorporation.com/en/careers",
  },
  {
    name: "BNP Paribas – Montréal",
    website: "https://group.bnpparibas",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "IT & operations hub. bnpparibas.com/en/careers – filter Montréal.",
  },
  {
    name: "Société Générale – Montréal",
    website: "https://careers.societegenerale.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "Technology & back-office operations centre. careers.societegenerale.com",
  },
  {
    name: "State Street – Montréal",
    website: "https://careers.statestreet.com",
    ats: "workday",
    city: "Montréal",
    is_target: false,
    notes: "Global custody & fund admin. IT roles. careers.statestreet.com – filter Canada.",
  },

  // ════════════════════════════════════════════════════════════════════════════
  // UNIVERSITIES & RESEARCH INSTITUTES – Montréal
  // Note: most hire via direct contact with professors or NSERC USRA grants.
  //       Mark the relevant PI's lab in the 'notes' and apply through hrXxx portals.
  // ════════════════════════════════════════════════════════════════════════════

  {
    name: "McGill University",
    website: "https://www.mcgill.ca/careers",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ Research assistant & IT intern roles across SOCS, Biology, Neuro labs. Apply via mcgill.ca/careers or email professors directly. NSERC USRA grants available May–Aug.",
  },
  {
    name: "Concordia University",
    website: "https://www.concordia.ca",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ GinaCody School of Eng. & CS. NSERC USRA, NEXT AI startup internships, CRSNG grants. concordia.ca/next-ai | hr.concordia.ca/jobs",
  },
  {
    name: "Polytechnique Montréal",
    website: "https://www.polymtl.ca",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ Engineering school – robotics, software, AI labs. MIRO & CRSNG USRA internships. polymtl.ca/rh/carrieres. Approach supervisors via lab websites.",
  },
  {
    name: "Université de Montréal – DIRO",
    website: "https://diro.umontreal.ca",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ Dept. Informatique & Recherche Opérationnelle. Hosts MILA & IFT lab interns. Apply via diro.umontreal.ca or contact professors directly.",
  },
  {
    name: "MILA – Quebec AI Institute",
    website: "https://mila.quebec",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "★ DIRECT EMAIL ★ World-leading AI institute (Yoshua Bengio). Research internships – mila.quebec/en/jobs/ or via affiliated UdeM/McGill profs. Also posts RA roles on ML mailing lists.",
  },
  {
    name: "HEC Montréal",
    website: "https://www.hec.ca",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Business school. Occasional data/BI tech intern roles. hec.ca/en/jobs or via CIRANO research centre.",
  },
  {
    name: "UQAM – Informatique",
    website: "https://www.uqam.ca",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "Research labs (video games, AI, graphics). Staff postings at rh.uqam.ca.",
  },
  {
    name: "IVADO",
    website: "https://ivado.ca",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes:
      "Institute for Data Valorization. AI/data science fellowships & industry internships. ivado.ca/en/scholarships/",
  },

  // ════════════════════════════════════════════════════════════════════════════
  // BIG TECH – Montréal offices & Canada-remote openings
  // Most run proprietary Workday / own portals. Boards post new reqs daily.
  // ════════════════════════════════════════════════════════════════════════════

  // ── With active Greenhouse / Lever boards (auto-discoverable) ────────────

  {
    name: "Shopify",
    website: "https://www.shopify.com/careers",
    ats: "greenhouse",
    board_token: "shopify",
    city: "Ottawa",
    is_target: true,
    notes:
      "Fully remote-first Canadian tech company. Dev Degree & intern streams; Greenhouse board posts year-round. Montréal-based candidates accepted.",
  },
  {
    name: "Lightspeed Commerce",
    website: "https://www.lightspeedhq.com",
    ats: "greenhouse",
    board_token: "lightspeed",
    city: "Montréal",
    is_target: true,
    notes:
      "Montréal-HQ'd commerce platform (TSX/NYSE). Greenhouse board; intern & co-op roles in backend, data, frontend posted each fall. [token unverified — may be 'lightspeedhq']",
  },
  {
    name: "Dialogue",
    website: "https://www.dialogue.co",
    ats: "greenhouse",
    board_token: "dialogue",
    city: "Montréal",
    is_target: true,
    notes:
      "Montréal digital health platform (TSX). Greenhouse board; tech intern roles in backend & data posted in fall. [token unverified]",
  },
  {
    name: "Vention",
    website: "https://vention.io",
    ats: "greenhouse",
    board_token: "vention",
    city: "Montréal",
    is_target: true,
    notes:
      "Manufacturing automation platform. Greenhouse board; SW engineering & robotics intern roles. [token unverified — may be 'vention-io']",
  },
  {
    name: "SSENSE",
    website: "https://www.ssense.com",
    ats: "lever",
    board_token: "ssense",
    city: "Montréal",
    is_target: true,
    notes:
      "Luxury fashion e-commerce with a large Montréal engineering org. Lever board; data, backend & ML intern roles. [token unverified]",
  },

  // ── Workday / own portals (manual entry) – major global brands ───────────

  {
    name: "Google – Montréal",
    website: "https://careers.google.com",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "Google DeepMind & Brain office. STEP intern & SWE intern programs – filter 'Montréal' on careers.google.com. Applications open Sep–Nov for summer.",
  },
  {
    name: "Microsoft – Montréal",
    website: "https://careers.microsoft.com",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "MSR & Azure engineering office. Intern program posted Oct–Jan. careers.microsoft.com – search 'intern Montreal'.",
  },
  {
    name: "Amazon – Montréal",
    website: "https://amazon.jobs",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "AWS & Alexa AI teams. SDE intern program; amazon.jobs – search 'intern Montreal'. New reqs posted almost daily.",
  },
  {
    name: "Meta – Montréal",
    website: "https://www.metacareers.com",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "FAIR (Fundamental AI Research) office. SWE internships; metacareers.com – filter Canada. Apply Sep–Nov for summer.",
  },
  {
    name: "Nvidia – Montréal",
    website: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Deep learning & GPU research hub. Intern roles in ML infra, CUDA, AI frameworks. Workday – search 'Montreal intern'. New reqs posted frequently.",
  },
  {
    name: "Autodesk – Montréal",
    website: "https://autodesk.wd1.myworkdayjobs.com/Ext",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Large Montréal engineering hub – Substance 3D (game art pipeline), Maya, Fusion 360. Active winter intern program. Workday portal.",
  },
  {
    name: "IBM – Montréal",
    website: "https://www.ibm.com/careers",
    ats: "other",
    city: "Montréal",
    is_target: true,
    notes:
      "Watson, cloud & IBM Research. Co-op program (Blue Waters / THINK). ibm.com/careers – filter Canada / Montréal.",
  },
  {
    name: "Salesforce – Montréal",
    website: "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
    ats: "workday",
    city: "Montréal",
    is_target: true,
    notes:
      "Tableau & Einstein AI teams. Futureforce intern program; apply Sep–Nov for summer. Workday portal.",
  },
  {
    name: "Cisco – Montréal",
    website: "https://jobs.cisco.com",
    ats: "workday",
    city: "Montréal",
    is_target: false,
    notes: "Networking & security. Co-op program. jobs.cisco.com – search 'Canada intern'.",
  },
  {
    name: "Adobe – Montréal",
    website: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
    ats: "workday",
    city: "Montréal",
    is_target: false,
    notes:
      "Substance 3D (game art pipeline), Creative Cloud. Intern program via Workday portal.",
  },
  {
    name: "ServiceNow – Montréal",
    website: "https://careers.servicenow.com",
    ats: "workday",
    city: "Montréal",
    is_target: false,
    notes: "Enterprise SaaS. Intern program. Workday portal. careers.servicenow.com",
  },
  {
    name: "Huawei Canada – Montréal",
    website: "https://career.huawei.com/reccampportal/portal5/index.html",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "5G & AI research lab. Internships in networks & ML. Apply via Huawei campus portal.",
  },

  // ── Other high-frequency Montréal tech employers ─────────────────────────

  {
    name: "Stingray Group",
    website: "https://www.stingray.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "Digital media & music streaming (TSX). Tech roles. stingray.com/en/about-us/careers",
  },
  {
    name: "AppDirect",
    website: "https://www.appdirect.com",
    ats: "lever",
    board_token: "appdirect",
    city: "Montréal",
    is_target: false,
    notes:
      "B2B marketplace platform. Lever board; tech intern roles in backend & platform. [token unverified]",
  },
  {
    name: "Propel Software",
    website: "https://propelsoftware.com",
    ats: "other",
    city: "Montréal",
    is_target: false,
    notes: "AI-powered fintech. Check propelsoftware.com/careers for opening intern roles.",
  },
];

async function main() {
  for (const c of companies) {
    await pool.query(
      `INSERT INTO companies (name, website, ats, board_token, city, is_target, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE
          SET website     = COALESCE(EXCLUDED.website, companies.website),
              ats         = COALESCE(EXCLUDED.ats, companies.ats),
              board_token = COALESCE(EXCLUDED.board_token, companies.board_token),
              city        = COALESCE(EXCLUDED.city, companies.city),
              is_target   = EXCLUDED.is_target,
              notes       = COALESCE(EXCLUDED.notes, companies.notes)`,
      [
        c.name,
        c.website ?? null,
        c.ats ?? null,
        c.board_token ?? null,
        c.city ?? null,
        c.is_target ?? true,
        c.notes ?? null,
      ],
    );
  }

  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM companies WHERE board_token IS NULL ORDER BY name`,
  );

  console.log(`${companies.length} companies seeded.`);
  if (rows.length) {
    console.log(`\n${rows.length} have no board_token, so discovery will skip them:`);
    for (const r of rows) console.log(`  ${r.name}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
