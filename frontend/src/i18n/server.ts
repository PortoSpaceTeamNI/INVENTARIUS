// The backend answers in English. In Portuguese, known messages (API errors,
// import row problems, printer states and the notes it adds to history) are
// translated here; anything unknown is shown as the server sent it.
import { dict } from ".";

const exact: Record<string, string> = {
  // api
  "sign in first": "Inicia sessão primeiro.",
  "not found": "Não encontrado.",
  "no such endpoint": "Endereço inexistente.",
  "invalid reference or value": "Referência ou valor inválido.",
  "internal error": "Erro interno do servidor.",
  "name is required": "O nome é obrigatório.",
  "only its owners can change this": "Só os donos podem alterar isto.",
  "only its department, the person who reserved it, or an admin can release it":
    "Só o departamento, quem reservou ou um administrador a pode libertar.",
  "admins only": "Só para administradores.",
  "you cannot remove your own admin access": "Não podes retirar o teu próprio acesso de administrador.",
  "write off the remaining quantity first": "Abate primeiro a quantidade que resta.",
  "unknown role": "Papel desconhecido.",
  "unknown parent location": "Local de cima desconhecido.",
  "unknown department": "Departamento desconhecido.",
  "the due time is in the past": "A data de devolução já passou.",
  "the CSV has no rows": "O CSV não tem linhas.",
  "send between 1 and 200 labels": "Envia entre 1 e 200 etiquetas.",
  "photo too large (max 20 MB)": "Foto demasiado grande (máx. 20 MB).",
  "only waiting jobs can be cancelled": "Só se podem cancelar impressões em espera.",
  "only finished jobs can be retried": "Só se podem repetir impressões terminadas.",
  "not a JPEG, PNG, GIF or WebP image": "Não é uma imagem JPEG, PNG, GIF ou WebP.",
  "links must start with http:// or https://": "Os links têm de começar por http:// ou https://.",
  "kind must be consumable, tool, hazmat or flight_hw":
    "O tipo tem de ser consumable, tool, hazmat ou flight_hw.",
  "it still has subcategories or items": "Ainda tem subcategorias ou artigos.",
  "empty it first: it still holds locations, stock or assets":
    "Esvazia-o primeiro: ainda tem locais, stock ou unidades.",
  "dates must look like 2026-12-31": "As datas têm de ser como 2026-12-31.",
  "count must be between 1 and 50": "A quantidade tem de estar entre 1 e 50.",
  "could not read the CSV header": "Não foi possível ler o cabeçalho do CSV.",
  "at most 5000 rows per import": "No máximo 5000 linhas por importação.",
  "a location cannot be inside itself": "Um local não pode estar dentro de si próprio.",
  "the room must be between 1 cm and 100 m on each side":
    "A sala tem de ter entre 1 cm e 100 m de cada lado.",
  "a map can have at most 500 shapes": "Um mapa pode ter no máximo 500 formas.",
  "every shape needs its own id": "Cada forma precisa do seu próprio id.",
  "shape names can be at most 80 characters": "Os nomes das formas têm no máximo 80 caracteres.",
  "shape kind must be storage, furniture or fixture":
    "O tipo da forma tem de ser storage, furniture ou fixture.",
  "colours must look like #2563eb": "As cores têm de ser como #2563eb.",
  "shapes must lie inside the room": "As formas têm de ficar dentro da sala.",
  "links must be a code like L12, I5, S40, A7 or C3":
    "As ligações têm de ser um código como L12, I5, S40, A7 ou C3.",
  "the linked thing does not exist": "O que está ligado já não existe.",
  "a category cannot be inside itself": "Uma categoria não pode estar dentro de si própria.",
  // auth
  "This account has been disabled.": "Esta conta foi desativada.",
  "Login expired, try again.": "O login expirou, tenta outra vez.",
  "Google sign-in is unreachable right now.": "O login da Google não está acessível de momento.",
  "Google sign-in failed.": "O login com a Google falhou.",
  "Could not start session.": "Não foi possível iniciar a sessão.",
  // inventory
  "owner is either a project or a department, not both": "O dono é um projeto ou um departamento, não ambos.",
  "quantity must be greater than zero": "A quantidade tem de ser maior que zero.",
  "count must be exact, approx or uncounted": "A contagem tem de ser exata, aproximada ou não contada.",
  "unknown location": "Local desconhecido.",
  "quantity cannot be negative": "A quantidade não pode ser negativa.",
  "it is already there": "Já está lá.",
  "it is not on loan": "Não está emprestado.",
  "use borrow to put an asset on loan": "Usa “Requisitar” para emprestar uma unidade.",
  "it is on loan; return it first": "Está emprestado; devolve-o primeiro.",
  "reserve either stock or a unit": "Reserva stock ou uma unidade.",
  "say what it is reserved for": "Diz para que é a reserva.",
  "the end date is in the past": "A data de fim já passou.",
  "it is retired": "Está abatido.",
  "it was already released": "Já tinha sido libertada.",
  "that reservation is not active for this stock": "Essa reserva não está ativa para este stock.",
  // printer
  "printer turned off while printing": "A impressora desligou-se a meio da impressão.",
  "printer did not answer (is it on?)": "A impressora não respondeu (está ligada?).",
  "no tape": "sem fita",
  "cutter jam": "cortador encravado",
  "weak batteries": "baterias fracas",
  "wrong (high-voltage) adapter": "transformador errado (alta tensão)",
  "wrong tape loaded": "fita errada",
  "cover open": "tampa aberta",
  overheating: "sobreaquecimento",
  "incompatible tape": "fita incompatível",
  // import rows
  "name is empty": "o nome está vazio",
  "tools and hardware are counted one by one: quantity must be a whole number up to 50":
    "ferramentas e hardware contam-se um a um: a quantidade tem de ser um número inteiro até 50",
  "quantity needs a location": "a quantidade precisa de um local",
  "status only applies to tools and hardware": "status só se aplica a ferramentas e hardware",
  "a serial number only fits a single tool": "um número de série só serve para uma ferramenta",
  'reserved_for/reserved_note need a reserved quantity (a number or "all")':
    'reserved_for/reserved_note precisam de uma quantidade reservada (um número ou "all")',
  "a reservation needs reserved_note (what it is for)": "uma reserva precisa de reserved_note (para que é)",
  '"all" of an uncounted lot can\'t be reserved; give a number':
    'não se pode reservar "all" de um lote não contado; indica um número',
  "reserve whole units": "reserva unidades inteiras",
  // part lookup
  "part not found at Mouser": "A Mouser não conhece esta referência.",
  "part lookup is not set up (INVENTARIUS_MOUSER_API_KEY)":
    "A pesquisa de componentes não está configurada (INVENTARIUS_MOUSER_API_KEY).",
  "could not fetch the image": "Não foi possível obter a imagem.",
  "not a Mouser image link": "Não é um link de imagem da Mouser.",
  "mpn is required": "A referência é obrigatória.",
  "the Mouser API key is not valid": "A chave da API da Mouser não é válida.",
  // history notes
  "first count": "primeira contagem",
  "marked as not counted": "marcado como não contado",
  estimate: "estimativa",
  "used reserved stock": "usou stock reservado",
  imported: "importado",
};

const codeKind: Record<string, string> = {
  location: "local",
  item: "artigo",
  stock: "stock",
  asset: "unidade",
};

/** Replaces "the team" and quantity "for" phrases inside messages that name purposes. */
const purpose = (s: string) => s.replace(/\bthe team\b/g, "a equipa");

const status = (s: string) => {
  const t = dict().status as Record<string, string>;
  return t[s]?.toLowerCase() ?? s;
};

const patterns: [RegExp, (...m: string[]) => string][] = [
  [/^invalid JSON: (.*)$/, (d) => `JSON inválido: ${d}`],
  [/^no (location|item|stock|asset) with code (\S+)$/, (k, c) => `Não há ${codeKind[k]} com o código ${c}.`],
  [
    /^line (\d+): (.*) \(rows before it were imported\)$/,
    (n, e) => `Linha ${n}: ${pt(e)} (as linhas anteriores foram importadas)`,
  ],
  [/^line (\d+): (.*)$/, (n, e) => `Linha ${n}: ${pt(e)}`],
  [
    /^the CSV needs a "name" column; known columns: (.*)$/,
    (c) => `O CSV precisa de uma coluna "name"; colunas conhecidas: ${c}`,
  ],
  [/^department (".*") is not in that project$/, (d) => `O departamento ${d} não é desse projeto.`],
  [/^only (\S+) left here$/, (n) => `Só restam ${n} aqui.`],
  [/^only (\S+) here to move$/, (n) => `Só há ${n} aqui para mover.`],
  [/^(.*) already has it$/, (u) => `${u} já o tem.`],
  [/^it is (\S+), not available$/, (s) => `Está ${status(s)}, não disponível.`],
  [/^unknown status (".*")$/, (s) => `Estado desconhecido ${s}.`],
  [/^only (\S+) free to reserve here$/, (n) => `Só há ${n} livre para reservar aqui.`],
  [/^it is already reserved for (.*)$/, (p) => `Já está reservado para ${purpose(p)}.`],
  [
    /^Only (\S+) free here; the rest is reserved: (.*)\.$/s,
    (n, rest) =>
      `Só há ${n} livre aqui; o resto está reservado: ${purpose(rest).replace(/(\d[\d.e+-]*) for /g, "$1 para ")}.`,
  ],
  [/^It is reserved for (.*) \((".*")\)\.$/s, (p, note) => `Está reservado para ${purpose(p)} (${note}).`],
  [/^Only @(\S+) accounts can sign in\.$/, (d) => `Só contas @${d} podem entrar.`],
  [
    /^printer has (\d+) mm tape loaded[;,] labels need (.*) mm$/,
    (n, need) =>
      `A impressora tem fita de ${n} mm; as etiquetas precisam de ${need.replace(" or ", " ou ")} mm.`,
  ],
  [/^printer: (.*)$/, (p) => `Impressora: ${p.split(", ").map(pt).join(", ")}`],
  [/^unsupported tape width (\d+) mm$/, (n) => `Largura de fita não suportada: ${n} mm`],
  [/^(.*) symbol for (".*") is too big for the tape$/, (k, c) => `O código ${k} para ${c} não cabe na fita`],
  [/^invalid code (".*"): unknown prefix$/, (c) => `Código inválido ${c}: prefixo desconhecido`],
  [/^invalid code (".*")$/, (c) => `Código inválido ${c}`],
  [
    /^kind (".*"): use consumable, tool, hazmat or flight_hw$/,
    (k) => `kind ${k}: usa consumable, tool, hazmat ou flight_hw`,
  ],
  [
    /^status (".*"): use available, broken, in_repair or retired$/,
    (s) => `status ${s}: usa available, broken, in_repair ou retired`,
  ],
  [/^expires_on (".*"): use YYYY-MM-DD$/, (e) => `expires_on ${e}: usa AAAA-MM-DD`],
  [/^min_stock (".*") is not a number$/, (m) => `min_stock ${m} não é um número`],
  [/^reserved (".*"): use a number or "all"$/, (r) => `reserved ${r}: usa um número ou "all"`],
  [
    /^reserved (\S+) is more than the quantity (\S+)$/,
    (r, q) => `reserved ${r} é mais do que a quantidade ${q}`,
  ],
  [/^reserved_for: (.*)$/, (e) => `reserved_for: ${pt(e)}`],
  [
    /^quantity (".*") is not a number \(use 12, 9\+1, ~10, 5 m, or \+\+\+ for not counted\)$/,
    (q) => `quantity ${q} não é um número (usa 12, 9+1, ~10, 5 m, ou +++ para não contado)`,
  ],
  [/^quantity (".*") is not a number$/, (q) => `quantity ${q} não é um número`],
  [/^quantity (".*"): unknown unit (".*")$/, (q, u) => `quantity ${q}: unidade desconhecida ${u}`],
  [
    /^owner (".*"): use INVICTUS, ICARUS or PROJECT\/Department$/,
    (o) => `owner ${o}: usa INVICTUS, ICARUS ou PROJETO/Departamento`,
  ],
  [
    /^owner (".*"): no such department in (.*)$/,
    (o, p) => `owner ${o}: não existe esse departamento em ${p}`,
  ],
  [/^location (".*") is empty$/, (l) => `location ${l} está vazio`],
  // history notes
  [/^imported (\(.*\))$/, (q) => `importado ${q}`],
  [/^borrowed while reserved for (.*)$/, (p) => `requisitado enquanto reservado para ${purpose(p)}`],
  [
    /^(available|on_loan|broken|in_repair|retired) → (available|on_loan|broken|in_repair|retired)$/,
    (a, b) => `${status(a)} → ${status(b)}`,
  ],
  [/^(.*) \(([^()]*)\)$/s, (note, sys) => `${note} (${pt(sys)})`],
];

function pt(msg: string): string {
  const hit = exact[msg];
  if (hit) return hit;
  for (const [re, f] of patterns) {
    const m = msg.match(re);
    if (m) return f(...m.slice(1));
  }
  return msg;
}

/** A message from the server in the chosen language, when it is a known one. */
export function serverText(msg: string): string {
  return dict().locale.startsWith("pt") ? pt(msg) : msg;
}
