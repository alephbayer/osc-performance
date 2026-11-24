# Pendências do sistema OSC

Lista viva do que ficou em aberto. **Leia no início de cada sessão e atualize ao terminar** (marque feito, acrescente o que surgir). Assim nada depende da memória da conversa.

## Em andamento: levar o desenvolvimento para o Claude Code no Mac
- [x] Instalar o Claude Code no Mac e abrir `~/osc-performance` (feito em 2026-11-23)
- [ ] Conectar GitHub (poder dar push), Supabase e Vercel no Claude Code do Mac
- [x] Primeira tarefa de teste pequena, conferindo o fluxo do `CLAUDE.md` (remoção do `ClientCard`, v2026.11.23.196)
- [x] Pasta de análise de orçamentos criada **fora** deste repositório (ele é público): `~/OSC/orcamentos` (ver `LEIAME.md` lá). Extração repetível do Supabase e primeiro retrato feitos em 2026-11-23
- [ ] **Aleph:** copiar planilhas e exportações de outros sistemas para `~/OSC/orcamentos/originais/` e preencher `INVENTARIO.md`
- [x] Plano do estudo aprovado (2026-11-23). Feitos fora do repositório: catálogo padronizado (81 serviços, regras em `scripts/catalogo_regras.mjs` lá) e protótipo `analises/orcamento-previo.html` (faixa de preço e prazo a partir do histórico)
- [ ] **Aleph:** usar o orçamento prévio nos próximos atendimentos e conferir o catálogo (`analises/catalogo-*.md`); apontar grupos errados
- [ ] Depois das outras fontes: comparar com tempos de manual; decidir se leva para o app (sugestão de preço no orçamento, alerta de valor fora da faixa, botão iniciar/parar tarefa para medir tempo real)

## Entregas 99 (99Entrega)
- [x] Base: tabela `deliveries_99` (migration 058) e tela Compras > Entregas 99, registro manual com link, status e custo; chefes sem valores (v2026.11.23.198)
- [ ] **Aleph:** cadastro da empresa em 99app.com/99-entrega (formulário: nome, telefone, CNPJ, e-mail) -> completar cadastro no Portal 99Entrega Empresas -> pedir acesso à API (no portal ou api-suporte@99app.com). Atenção: a 99 anuncia API/Portal para quem faz mais de 300 entregas/mês; abaixo disso indica o app. Sem mensalidade, paga por km
- [ ] Com a documentação: edge function `entrega-99` (OAuth, cotar/criar/cancelar/consultar + webhook com assinatura), secrets no Supabase; passar nos testes de sandbox exigidos pela 99. A API só acompanha entregas **criadas pela API** (`external_order_id`); entregas pedidas no app da 99 continuam manuais
- [ ] Conferir no app ao vivo a tela Entregas 99 (owner e um chefe)

## Entregas Uber (Uber Direct)
- [x] Tela única Compras > Entregas (99 e Uber), migration 059 (`provider`, endereços, entregador) e edge functions `uber-direct` (JWT) e `uber-direct-webhook` (sem JWT, assinatura HMAC) (v2026.11.23.199)
- [x] **Aleph:** criar a conta em direct.uber.com (conta Uber da empresa), aceitar os termos; na aba Developer pegar as credenciais de **teste** e gravar nos secrets do Supabase: `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_CUSTOMER_ID`
- [x] **Aleph:** em Developer > Webhooks, criar webhook `https://lchfmoeyzgbepunetuch.supabase.co/functions/v1/uber-direct-webhook` (tipos delivery_status e courier_update) e gravar a Signing Key em `UBER_WEBHOOK_SIGNING_KEY`
- [x] Sandbox testado em 2026-11-23 pela função: cotar (R$ 12,40, BRL), pedir, atualizar, cancelar e webhook com assinatura válida. Obs.: no painel, "ID de cliente do desenvolvedor" = `UBER_CLIENT_ID` e "ID do usuário" = `UBER_CUSTOMER_ID`
- [x] **Cobertura:** a Uber Direct não atende a região da oficina (Vargem Pequena/Barra/Recreio), confirmado pelo Aleph em 2026-11-23. Integração fica pronta e parada; entregas Uber feitas no app da Uber são registradas à mão na mesma tela. Reavaliar se a Uber ampliar a área (perguntar ao suporte da Uber Direct)
- [x] Endereço mais fácil: CEP preenche pelo ViaCEP; agenda de destinos pelo nome (v2026.11.23.200)
- [ ] Testar pela tela do app (Gestor) numa região atendida: pedir, ver status mudar sozinho; simular entregador com o Robocourier da Uber
- [ ] Produção: cartão em Billing + aprovação da Uber; trocar as credenciais de teste pelas de produção. Limite de segurança: `UBER_MAX_PER_DAY` (padrão 10 pedidos/24 h), porque a função aceita qualquer chamada com a chave pública do app (ver item de segurança sobre Supabase Auth)

## Cobrança parcial em PDF
- [x] Botão "Cobrança parcial" na OS (só Gestor/Administrativo): escolhe tarefas, MO, peças, despesas e garantia (cortesia) e gera PDF "Cobrança parcial" com total do que foi marcado; não mostra pagamentos nem saldo da OS e **não grava nada** (decisão do Aleph). Teste: `node scripts/pdf-test.cjs x.pdf parcial` (v2026.11.23.203)
- [ ] **Aleph:** conferir no app ao vivo numa OS da Performance e numa da Finishing (seleção, total, registrar, travas, cancelar e PDF no celular)
- [x] Registro do que já foi cobrado: tabela `partial_charges` (migration 060). Ao gerar, "Registrar e gerar" ou "Só gerar PDF"; itens registrados ficam travados (com aviso se o valor mudou depois), cobrança numerada, cancelar libera os itens, PDF pode ser gerado de novo. O PDF final da OS não muda (decisão do Aleph) (v2026.11.23.204)
- [ ] Limite conhecido: a trava da peça usa tarefa + nome + marca. Renomear a peça depois de cobrada solta a trava; aumentar horas/quantidade só mostra aviso "valor mudou", não cobra a diferença

## Ajustes nos PDFs (sessão dedicada, 2026-11-24)
- PDFs existentes: orçamento Performance e Finishing (`renderElegantQuote`), cobrança parcial, conferência de entrega, peças importadas, pré-aprovação de agendamento, financeiro. `generateQuotePDFLegacy`/`generateFinishingPDFLegacy` não são chamados (código morto)
- [x] Página "Investimento e condições" (serviço único em Ficha): nome longo do serviço passava por cima do total; agora quebra em linhas à esquerda do valor (v2026.11.24.205)
- [x] Revisão do orçamento QUW2C12: ponto duplo no escopo resumido, CNPJ formatado no cabeçalho, prazo só na tabela da capa quando há 1 serviço em Ficha, título da continuação cortado por palavra, página de investimento sem espaço vazio (v2026.11.24.206)
- [ ] Observado no teste (antigo, não mexido): quando há despesas adicionais na página de investimento, as formas de pagamento e o aceite podem ir sozinhos para uma página nova
- Sem poppler neste Mac: para ver PDFs, compilar um conversor PDFKit em Swift (ver nota da sessão) ou `brew install poppler`

## Link de acompanhamento do veículo (sessão dedicada, 2026-11-24)
- Links: `?v=<id>` (acompanhamento, `PublicVehicleView`), `?vh=<id>` (histórico, `PublicVehicleHistoryView`); `?portal=cliente` usa a mesma `PublicVehicleView` com login. Encurtador `shorten-url` só é usado no Portfólio
- [x] `?v=` e `?vh=` carregam só os dados daquele veículo (`db.loadPublicVehicle` em `supabase.js`, componente `PublicVehicleRoot`): antes baixavam o banco inteiro (todos os clientes, pagamentos, estoque) para o navegador de quem abrisse. Pedidos de peça sem custo/link; funcionário e cliente só id e nome; atualiza a cada 60 s e ao voltar para a aba (antes era realtime). `?vh=` passou a esconder tarefas internas/sem valor, como o `?v=` (v2026.11.24.207)
- [ ] Limite: com a chave pública e policies `using (true)`, quem souber usar a API ainda lê qualquer tabela (ver Segurança). A correção acima tira os dados da página, não do banco
- [ ] Limite: foto de peça vinda do estoque agora casa o nome exato (antes ignorava maiúsculas/minúsculas)
- [x] Linha do tempo "Materiais — tarefa": editar nome/marca/qtd/valor de um material contava como novo lançamento (comparava por nome) e o aviso "Materiais atualizados" saía a cada mudança. Agora só itens acrescentados contam (`addedMaterials`), o aviso diz "Material incluído" e inclusões seguidas viram um registro só (v2026.11.24.208)
- [x] Apagados 12 registros repetidos antigos (nome antigo de material renomeado), em 2026-11-24, com o ok do Aleph; cópia em `~/OSC/backups/timeline-materiais-apagados-2026-11-24.json` (13 linhas: inclui "Bronzina de biela 010", que o Aleph decidiu manter no banco)
- [x] Testado pelo Aleph no app ao vivo (2026-11-24): editar material não gera mais lançamento
- [x] Aba Conta simplificada: "A pagar agora" no topo; resumo com total da OS, já pago e restante até a entrega; pagamentos e detalhamento recolhidos; saiu o comparativo "Investido até agora" e os textos de fórmula. Nomes do Pix/TED **não mexer** (pedido do Aleph) (v2026.11.24.209)
- [x] Limpeza do que o cliente vê: materiais recolhidos por tarefa (`PvMatToggle`), linha do tempo do link sem eventos `materials` (continuam no banco e no app interno), status de pedido de peça: Pedido / A caminho / Chegou (v2026.11.24.210)
- [x] Linha do tempo do link: materiais voltam consolidados, uma entrada por tarefa ("Peças e materiais — tarefa", N itens, 3 primeiros nomes, data do último lançamento), lidos da tarefa atual (`pvTimeline`); tarefa interna/renomeada não aparece. Pagamentos formatados e com valor oculto quando "Valores ocultos". Emojis trocados por ícones de traço (`PvIc`) no `?v=` e `?vh=`; cabeçalho `OscLockup div=` mostra só a divisão do carro (v2026.11.24.211)
- [ ] Os títulos da linha do tempo ainda são gravados com emoji no banco (o link tira na exibição; o app interno continua mostrando)
- [x] Materiais da linha do tempo expansíveis item a item; histórico virou aba "Histórico" do `?v=` (links `?vh=` antigos redirecionam para `?v=<8>&aba=historico`); link curto `?v=<8 primeiros caracteres do id>` em `getPublicLink`, WhatsApp e "Link histórico" (sem migration; `loadPublicVehicle` resolve o prefixo e exige que seja único; 119 veículos, 0 colisões em 2026-11-24). Links com id inteiro continuam valendo (v2026.11.24.212)
- [ ] **Em espera (Aleph, 2026-11-24)**: link seguro / fechar o banco. Discutido: proteger só o link (opção A) não basta, porque o app interno usa a mesma chave pública; recomendado opção B em fases (backup -> login do app pelo Supabase Auth -> link por código + função no banco -> portais mecânico/cliente -> fechar tabelas uma a uma). Faltam decisões do Aleph: A ou B, validade do link do cliente, e como o cliente entra no `?portal=cliente`. Detalhe original: link seguro com código próprio revogável e função no banco que devolve só aquele carro, para fechar as tabelas à chave pública (discutir antes de mexer). Obs.: o link curto tem 8 caracteres hex; hoje isso não piora nada porque a API pública já lista todos os veículos

## Portal do cliente (sessão dedicada, 2026-11-24)
- Como funciona: `?portal=cliente` -> `ClientPortalRoot` (raiz própria, não carrega o app interno) -> `ClientLoginScreen` (celular + PIN) -> `ClientPortal`. Tocar num veículo abre a `PublicVehicleView`
- [x] PIN e sessão no banco (migration 060, v2026.11.24.215): `client_portal_pins` (bcrypt) e `client_portal_sessions` fechadas à chave pública; funções `portal_find_client`, `portal_create_pin`, `portal_login` (5 erros = 15 min de bloqueio), `portal_logout`, `portal_reset_pin`, `portal_load` (só os dados do cliente da sessão; sessão expira com 180 dias sem uso). Tela de login não baixa mais nenhuma tabela (antes, 25). PIN antigo salvo no aparelho é migrado no primeiro acesso; todos os clientes precisam entrar de novo uma vez
- [x] "Resetar PIN do portal" (cadastro do cliente, só gestor) agora apaga PIN e sessões no banco; antes só mexia no aparelho de quem clicava
- [ ] **Aleph:** entrar no portal com um número de cliente seu (ou de teste) e conferir login, criação de PIN e a tela logada. Testado por Claude só com respostas simuladas no navegador local e leituras no banco; as funções `portal_create_pin`/`portal_login`/`portal_load` não rodaram com uma sessão real
- [ ] Limites que continuam: quem tem a chave pública ainda lê as tabelas direto e pode chamar `portal_reset_pin` (o app interno usa a mesma chave); quem souber o celular de um cliente que ainda não criou PIN pode criar antes dele. Resolve junto com o link seguro / fechar o banco (seção Link de acompanhamento)
- [x] Clientes com celular repetido unificados no cadastro mais antigo (Aleph autorizou, 2026-11-24): Bruno (repetido vazio) e José Henrique (veículo, 2 OSs e 1 agendamento passaram para o cadastro antigo). Cadastros apagados: `d2a9be4a…`, `e9b38aea…`. Se aparecer outro número repetido, o portal entra no cadastro mais antigo
- [x] Aprovar/recusar orçamento (portal e link `?q=`) manda push à oficina, sem valores porque chega também aos chefes (v2026.11.24.216)
- [x] Rascunho fica interno: o portal não mostra nem carrega orçamento `draft` (migration 061). O push "Orçamento disponível" saiu da criação e foi para o botão "Enviar"; "Orçamento atualizado" só vai se o orçamento já foi enviado. **Aleph:** o rascunho que já existe para um cliente só volta a aparecer para ele depois de "Enviar". Não testado no app interno (precisa da senha): o push do "Enviar"
- [x] O link público de orçamento `?q=` tem raiz própria (`PublicQuoteRoot`) e lê só aquele orçamento; antes carregava o banco inteiro (v2026.11.24.217)
- [x] Link `?q=`: título usa modelo e placa do veículo cadastrado; botão WhatsApp do cadastro do cliente abre a conversa (v2026.11.24.219). "Nova versão" na primeira visita não é bug: só aparece quando o navegador já guardou uma versão anterior
- [x] Emojis restantes: títulos de push, botões de editar, status de pedidos/investimentos (antes o push de pedido saía com "check"/"cart" escrito no título) e abas do quadro (v2026.11.24.218). Ficaram de propósito os símbolos de texto ✓ ✕ → ← ⌘
- [x] Decidido (Aleph, 2026-11-24): as mensagens de WhatsApp montadas pelo app **mantêm** os emojis; a regra "sem emojis" vale para a interface e as notificações
- [x] Bloco 1 da revisão do portal (v2026.11.24.220): aprovar/recusar com confirmação (portal e `?q=`); anotação nova manda push à oficina e mostra erro se falhar; anotação só pode ser apagada até 15 min depois (só na interface; o banco segue aberto)
- [x] Revisão do portal, bloco 2 (v2026.11.24.221): botão WhatsApp da oficina no topo (`OSC_WA`); aviso no iPhone sobre Tela de Início; "Agora não" lembrado 30 dias; barra de baixo com até 5 abas (Agendamentos e Peças viraram atalhos no Início); login com DDD; confirmar ao sair
- [ ] Revisão do portal, bloco 3 (limpeza): código morto no `ClientPortal` (popup de saldo nunca exibido, cálculo de dívida sem uso, `tabBtn`); saldo calculado em 3 lugares (cartão, Conta, página do veículo)
- [ ] Ideia: aprovação parcial de orçamento (cliente escolhe os itens). Nem portal nem `?q=` têm; a conversão em agendamento já usa `approvedItems`, mas a lista de orçamentos da oficina não mostra o que foi aprovado
- [ ] Achado não tratado: os 4 quadrinhos do PIN às vezes não pulam sozinhos para o próximo dígito (automação; conferir no celular)

## Para o Aleph validar
- [ ] Chefe de Pintura: entrar com a senha nova e conferir que só aparecem os carros da Finishing, sem nenhum valor
- [ ] Subir o backup (zip de `backup-AAAA-MM-DD/`) para o local privado e confirmar

## Funcionalidades combinadas, ainda não feitas
- [ ] Listar itens do Mercado Livre destinados automaticamente antes da v189 e ainda sem confirmação do administrador
- [ ] Validade da proposta em PDF (precisa o número de dias definido pelo Aleph)

## Limpeza técnica
- [x] Remover o código morto `ClientCard` em `App.jsx` (v2026.11.23.196)
- [x] Remover do Git a cópia antiga `src/App.jsx.bak` (v2026.11.23.197)
- [x] `index.html`: removido o script do `<head>` que dava erro de `classList` desde 03/08 (e por isso nunca rodou: trava de rolagem e ajuste de altura do iPhone) e o CSS que dependia dele; nenhuma mudança no uso (v2026.11.23.202)
- [ ] Changelog: faltam as entradas entre 2026-08-19 e 2026-11-18 (`public/changelog.json`)

## Segurança (sem urgência, discutir antes de mexer)
- [ ] Repositório `alephbayer/osc-performance` está público no GitHub; avaliar deixar privado
- [ ] Muitas tabelas aceitam acesso pela chave pública (`anon`) com policy `using (true)`; correção real exige Supabase Auth (mudança grande)
- [ ] Backup mensal (ou antes de mudança grande no banco): `scripts/backup.mjs` e `scripts/schema.mjs`

## Pitstop (depois)
- [ ] A edge function `manual-ask` existe só no Supabase e o Pitstop (`manual-fueltech` no Vercel) não tem repositório; guardar o código em um repositório
