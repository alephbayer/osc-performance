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

## Catálogo de serviços (menu padrão)
- [x] Análise (2026-11-26): não havia catálogo; serviço era texto livre na OS, orçamento e agendamento. 670 tarefas da Performance com 650 nomes diferentes, preços muito variados para o mesmo serviço, 165 tarefas a R$ 380/h (padrão hoje R$ 420), 185 sem valor, 18 sem categoria
- [x] Tabela `service_catalog` (migration 064), tela Mais > Catálogo de serviços (gestor e administrativo) e sugestão do catálogo ao digitar o nome na Nova tarefa, no orçamento e no agendamento. Valores são copiados para a tarefa; mudar o catálogo não altera OS antiga. Por hora sem R$ próprio usa a MO vigente (v2026.11.26.245)
- [x] Carga inicial: 79 serviços do estudo (`~/OSC/orcamentos/dados/catalogo.json`, sem "Outros" e "Parafusos e consumíveis"), com horas medianas, categoria e observação (orçar caso a caso / candidato a preço de tabela). `source_key` = `estudo:<id>`
- [ ] **Aleph:** revisar o catálogo no app: nomes, categorias, horas (ex.: "Diagnóstico e conferência" veio com 0,1 h; "Primeira partida e break-in" sem horas), e dar preço fechado aos candidatos a tabela
- [x] Catálogo também no campo inline "Nova tarefa…" do carro (era o que o Aleph usa; antes só estava no modal da página de etapas). Lista de sugestões em portal, fixa na tela (v2026.11.26.247)
- [x] Aleph confirmou no app ao vivo (2026-11-26): lista do catálogo aparece no campo "Nova tarefa…" do carro
- [ ] Ainda conferir ao vivo: criar/editar serviço na tela do catálogo, Finishing, orçamento e agendamento
- [ ] Depois: padronizar nomes das tarefas antigas? (só com OK, mexe em dados de produção)
- [x] Símbolos ✓/✕/✗ da interface trocados por `<Ic n="done"/>`, `<Ic n="x"/>` (novo) e `<Ic n="xc"/>`; ✓ removido dos avisos (toasts); PDF "Quitado" sem ✓ (v2026.11.26.246). Conferir no app ao vivo o alinhamento dos ícones

## Estética dos cards (veículo e mecânico, 2026-11-26)
- [x] Chips 3º/Gar./Int./Ficha cinza (cor só ligado, sem selo repetido "Terceirizado"/"Garantia"), desconto sem vermelho, origens de material como links finos (v2026.11.26.249)
- [x] Tarefas com escala única: fontes 10/12/13, peso 400/600, raio 6 (v.250)
- [x] Linha de horas como texto "0 h × R$ 420,00/h", alternar por hora/quantidade, total sem caixa (v.251)
- [x] `InlineEdit`: lápis colado ao texto, some em campo vazio, prop `bare` sem lápis; nome da tarefa edita ao tocar; 16 `style` duplicados juntados (títulos de seções voltaram a ter cor/tamanho, sem caixa-alta) (v.252)
- [x] Cabeçalho de categoria sem caixa-alta, total cinza, chevron de traço; card do mecânico sem sombra, borda fina, etiquetas normais, ações só ícone (v.253)
- Conferido no preview local (build de produção, perfil Gestor, celular, tema claro): card do veículo e lista de mecânicos. **Não conferido:** tema escuro, Finishing, tarefa com valor/desconto, portal do mecânico
- [x] Aleph preferiu: botões de material (estoque, Mercado Livre, link) de volta às cores; total da categoria em negrito na cor da categoria (v.255; a v.254 subiu só o changelog por erro de script)
- [x] Topo do card do carro (v.256): no celular (< 600 px, hook `useNarrow`) nome em até 2 linhas, informações agrupadas, total da OS numa faixa própria; barra de progresso com trilho visível; anotações do cliente em 12 com "ver mais" (3 linhas) e "Recebido" discreto; "Abrir página do carro" virou link à direita; Observações com 2 linhas e cresce ao digitar. Conferido no preview (celular e PC); anotações do cliente não conferidas (carro de teste sem anotação)
- [x] Página do carro (`VehicleStagesPage`) no iPhone: faixa fixa do tamanho da status bar (`env(safe-area-inset-top)`), o topo não fica mais atrás da hora/bateria (v.257). Não conferido no iPhone (o preview não simula a área segura). Aleph ainda via conteúdo na região com blur; faixa aumentada em 10 px (v.258) e, a pedido do Aleph, mais 20 px (área segura + 30 px, v.259). Se persistir: procurar overlay com blur no topo (não achei no código) ou testar `apple-mobile-web-app-status-bar-style` diferente
- [x] Cabeçalho do card do carro (`VehicleCard`): marca em linha própria acima do modelo (âmbar, 11 px, caixa-alta espaçada) e modelo em 15/600 escrita normal. Só no card; Depois (v.270): `VehName` ganhou `stack` (marca em linha própria, .70em) usado em 34 títulos; ficaram na mesma linha só textos cinzas de apoio, frases de confirmação, aviso de placa e selos. Marca do card em 9,5 px. Conferido no preview (PC): card e lista de Veículos
- [ ] **Aleph pensando:** botões de ação do card (Link/PDF/Pronto/Conta + 9 secundários coloridos). Proposta: 4 principais mais baixos e só contorno; secundários neutros com ícone colorido; no celular só os 3-4 mais usados e o resto no "…" do card (Link/PDF/Estimados/Conta e a grade de ações coloridas), que ainda pesam

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
- [x] Revisão do portal, bloco 3 (v2026.11.24.223): código morto removido do `ClientPortal`; cartão do Início e aba Conta usam `portalVehicleDue` (valores conferidos iguais antes/depois num cliente com 4 veículos). A página do veículo (`PublicVehicleView`, sessão do link de acompanhamento) ainda tem a própria conta
- [ ] Ideia: aprovação parcial de orçamento (cliente escolhe os itens). Nem portal nem `?q=` têm; a conversão em agendamento já usa `approvedItems`, mas a lista de orçamentos da oficina não mostra o que foi aprovado
- [ ] Achado não tratado: os 4 quadrinhos do PIN às vezes não pulam sozinhos para o próximo dígito (automação; conferir no celular)

## Importar OSs de sistemas antigos (sessão dedicada, 2026-11-26)
- Fontes (Aleph): planilhas próprias (xlsx/CSV) e OSs em papel/PDF. Trazer clientes, veículos, serviços, peças, valores e pagamentos. Caminho: script no Mac (não tela no app)
- Mapa: OS fechada em `os_history` (`tasks_snapshot` com `materials`), `clients`, `vehicles`, `payments` (`os_history_id`). `db.archiveAndResetVehicle` não serve para importar (zera o veículo)
- Decidido (Aleph): pagamento entra como estiver na OS antiga; sem dado de pagamento, a OS fica em aberto (aparece no "A receber") e o Aleph lança à mão pelo extrato do banco
- Plano: normalizar em `~/OSC/importacao/normalizado/` -> relatório de conferência (duplicados por placa e telefone, totais que não batem) -> migration 065 (origem e número antigo em `os_history`; números antigos colidem com 1-172) -> `scripts/importar-os.mjs` (simula por padrão, grava com limite, log para desfazer) -> teste com 3 a 5 OSs -> backup -> resto
- [ ] **Aleph:** copiar planilhas e PDFs para `~/OSC/importacao/originais/` (pasta criada, fora do repositório)
- [x] Teste 1 (2026-11-26): uma OS do Onmotor (PDF), carro ainda em trabalho -> gravada como **OS aberta OS-177** (número novo, decisão do Aleph; número antigo na observação do carro). Cliente e veículo novos, sem pagamento. Ids para desfazer em `~/OSC/importacao/log/`
- [x] OS-177 conferida pelo Aleph no app (2026-11-26)
- [ ] **Aleph:** ver se o Onmotor exporta as OSs em planilha; colocar as próximas em `~/OSC/importacao/originais/`
- Regra para as próximas: OS em andamento entra como OS aberta com número novo; OS entregue vai para `os_history` (aí precisa da migration de origem)

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

## Pagamentos (sessão dedicada, 2026-11-26)
- Mapa: OS aberta `AccountModal`/`QuickPayModal` (dividido Performance/Finishing via `insertPayment` + `group_id`); OS fechada `OsHistoryPaymentPanel` (desconto, "Salvar crédito" = pagamento negativo "Crédito"); "A receber" `computeReceivables` (só gestor); portal `portalVehicleDue`; link `?v=` com conta própria; PDF `renderElegantQuote` mostra pagamentos e saldo
- [x] Formas de pagamento: lista única `PAY_METHODS` (Pix, Dinheiro, Cartão de débito, Cartão de crédito, Transferência, Boleto, Outro) em todas as telas, inclusive vendas; `payMethodLabel` padroniza nomes antigos na exibição (PIX/pix, Cartão Crédito, TED / DOC...; "Crédito" vira "Crédito do cliente"). Banco não alterado (v2026.11.26.227)
- [x] Nomes padronizados gravados no banco com o ok do Aleph (2026-11-26): 65 linhas em `payments`, 9 em `sales`; "Crédito" (crédito de cliente) mantido. Cópia dos valores antigos em `~/OSC/backups/formas-pagamento-antes-2026-11-26.json`
- [x] Pagamento dividido: dá para digitar a parte da Finishing e a Performance fica com o restante (ou o contrário); a última digitada prevalece (v2026.11.26.228)
- [x] Pagamento dividido: se o valor cobre o saldo de uma empresa, aparece "Quitar <empresa>: R$ X" embaixo do campo dela (v2026.11.26.229)
- [x] Correções (v2026.11.26.230): pagamento dividido apaga as 2 partes juntas e forma/data/observação valem para as duas (valor continua por parte); excluir pede confirmação também na OS fechada e no agendamento; atalho de pagamento rápido manda push e linha do tempo (`notifyPayment`); pagamento de OS fechada não vai para a linha do tempo da OS atual; crédito interno não manda push; PDF mostra excedente convertido em crédito como dedução
- [x] Achado e corrigido junto: o PDF da OS Performance somava os pagamentos da Finishing no pago/saldo (v2026.11.26.230)
- [x] Aviso quando o pagamento passa do saldo (`OverpayNote`), com "Usar R$ saldo"; só avisa, não bloqueia (v2026.11.26.231)
- [x] Usar crédito do cliente na OS aberta (Conta Corrente): lança crédito negativo "Usado em OS-..." + pagamento "Crédito"; contexto `CreditCtx` com `applyClientCredit`. Na OS fechada, usar crédito agora também lança um negativo só (antes apagava/abatia lançamentos um a um) (v2026.11.26.232)
- [x] Contas de saldo unificadas em `openOsAccount` (Conta Corrente, pagamento rápido, A receber, Financeiro, portal, link `?v=`), mesma regra do fechamento; `vehicleTotal` passa a somar `fuelCost` antigo (hoje 0 em todos); cartão e página de etapas da Finishing não somam mais reboque/frete do veículo; `vehicleBalance` (sem uso) removida. Comparado com os dados reais (56 OSs abertas): portal, Conta Corrente e painel A receber sem mudança; só a aba Financeiro mudou em 15 veículos (antes ignorava extras e desconto da OS; soma +R$ 12.598,80) (v2026.11.26.233)
- [ ] Ainda com conta própria (de propósito, não é saldo): cobrança parcial (`partialChargeBuild`) e PDFs (`renderElegantQuote`); "executado/investido" (`executedValue`) segue separado
- [x] Recibo de pagamento em PDF (`generatePaymentReceiptPDF`, `paymentReceipt`, `extensoBRL`): botão em cada pagamento da Conta Corrente e da OS fechada; pagamento dividido sai num recibo só com as duas partes; situação da OS no dia (v2026.11.26.234). Testado com PDFs de exemplo; não testado no celular
- [x] Recibo pelo WhatsApp (v2026.11.26.235): celular compartilha o PDF (Web Share); sem suporte, abre wa.me do cliente com o texto (`receiptWaText`) e baixa o PDF. **Aleph:** testar no iPhone (o compartilhamento pode ser bloqueado se o PDF demorar; aí cai no plano B)
- [x] Recibos no portal do cliente: botão "Recibo" nos pagamentos da OS aberta (aba Conta) e das OSs anteriores; `portal_load` passou a devolver `company` (migration 063, aplicada em 2026-11-26; função conferida igual à 061 antes) (v2026.11.26.238). **Não testado com sessão real do portal**: Aleph, entrar no portal e baixar um recibo
- [x] Portal: lista de pagamentos da OS aberta volta a mostrar o valor (tinha saído no redesenho da aba Conta) (v2026.11.26.239)
- [x] Botão "Quitar tudo" na Conta Corrente e no pagamento rápido: saldo da OS inteira, dividido entre as empresas quando há as duas (v2026.11.26.236)
- [x] Recibo testado pelo Aleph no celular (funcionou). Conta Corrente redesenhada para o celular: resumo com saldo em destaque, campos em grade, lista de pagamentos com ações ao tocar (v2026.11.26.241). Conferida em tela de celular com dados de exemplo. Pagamentos da OS fechada no mesmo visual (v2026.11.26.242)
- [x] Modais centralizados com margem da barra de status/indicador do iPhone (`MODAL_PAD`, 35 janelas; altura máxima limitada à área livre) (v2026.11.26.243/244). Ficaram de fora telas cheias e folhas de baixo (QuickActionSheet, NovaOSModal, VehicleStagesPage), que já tratam a barra ou abrem de baixo. Não testado no iPhone janela por janela
- [x] Filtro em Pagamentos do cliente (período e forma, total do filtro) (v2026.11.26.237). Todas as melhorias levantadas na revisão de 2026-11-26 foram feitas
- [ ] Sinal de agendamento (`appointment_payments`) não passa para a OS ao converter (hoje a tabela está vazia)
- [ ] Contas de saldo espalhadas (`vehicleBalance` ignora fretes/importados; Financeiro, portal e link com contas próprias): unificar
- [ ] Data do pagamento: OS aberta grava só o dia, OS fechada grava dia e hora
- [ ] Não testado no app ao vivo (precisa senha): conferir as listas no lançamento e na edição de pagamento

## Correções de dados
- [x] Fechar OS (Performance) não somava fretes do veículo nem peças importadas no total gravado, não os guardava no histórico e não os zerava no veículo (migration 062: `os_history.import_parts`). OS-127 (ASZ0D70) corrigida de R$ 11.897,80 para R$ 12.923,74 em 2026-11-24
- [x] LDM0202 OS-172: frete de R$ 63,29 (rolamentos, São Cristóvão > OSC) estava fora do total; corrigido de R$ 1.434,39 para R$ 1.497,68 (= pago, quitada) em 2026-11-24
- [x] ETE8I22 OS-142: total gravado (R$ 5.988,86) confere com as tarefas; o 2º Pix (19/10, R$ 3.115,95) foi calculado com a OS em R$ 6.060,95 e um item de R$ 72,09 saiu antes da entrega (sem registro do que era). Com o ok do Aleph (2026-11-26), virou crédito do cliente: `client_credits` +72,09 "Excedente OS-142" e pagamento -72,09 "Crédito" na OS (mesmo que o botão "Salvar crédito"). OS quitada; cliente com R$ 72,09 de crédito
- [x] CAC8J62: a "OS sem número" (02/09, total 0) era um registro vazio com cópia dos 2 Pix da OS-24 (R$ 6.000 de 06/03 e R$ 25.000 de 28/05, relançados na OS-24 em 11/08 porque os originais não tinham ido para ela no fechamento). O Financeiro contava R$ 31.000 a mais. Com o ok do Aleph (2026-11-26), apagados o registro vazio e os 2 pagamentos duplicados; cópia em `~/OSC/backups/CAC8J62-os-vazia-apagada-2026-11-26.json`
- [x] OS-24 da CAC8J62: R$ 6.547,29 em aberto confirmado pelo Aleph (2026-11-26), o cliente ainda deve; nada a corrigir
- [x] Entregar veículo sem OS aberta e sem tarefas da Performance agora é bloqueado em `deliverVehicle` e o botão some (v2026.11.26.240). Finishing já exigia OS aberta

## Segurança (sem urgência, discutir antes de mexer)
- [ ] Repositório `alephbayer/osc-performance` está público no GitHub; avaliar deixar privado
- [ ] Muitas tabelas aceitam acesso pela chave pública (`anon`) com policy `using (true)`; correção real exige Supabase Auth (mudança grande)
- [ ] Backup mensal (ou antes de mudança grande no banco): `scripts/backup.mjs` e `scripts/schema.mjs`

## Pitstop (depois)
- [ ] A edge function `manual-ask` existe só no Supabase e o Pitstop (`manual-fueltech` no Vercel) não tem repositório; guardar o código em um repositório

## Consulta de veículo pela placa (sessão dedicada, 2026-11-26)
- Provedor escolhido pelo Aleph: **API Placas** (apiplacas.com.br, API em `wdapi2.com.br/v3`), só a consulta **completa** (R$ 0,20: marca, modelo, ano, cor, combustível, cilindrada, potência, chassi, número do motor, Renavam). Sem FIPE, então a versão não vem: o modelo sai como "Marca Modelo 1.6" (cilindrada quando vier). Placa não encontrada e erros não são cobrados. Comparação completa dos provedores nas notas da sessão
- [x] Migration 066 (`migration_066_plate_lookup.sql`; a 065 fica reservada para a importação de OSs): colunas `chassis`, `engine_number`, `fuel_type` em `vehicles`; cache `plate_lookups` (RLS sem policies, só a função lê). Cada placa encontrada é paga uma vez só
- [x] Edge function `plate-lookup` (JWT): cache -> limite `PLATE_MAX_PER_DAY` (padrão 30 consultas pagas em 24 h) -> API Placas. Testada no ar sem token (responde "não configurada"), placa inválida e sem JWT (401). Normalização testada com o JSON de exemplo da documentação
- [x] App: "Buscar pela placa" no Novo veículo e em "Dados do veículo" (card e página do veículo). Mostra o que veio ao lado do valor atual; campos vazios vêm marcados, valor já preenchido diferente fica desmarcado; nada salva até "Aplicar". Campos novos Chassi, Motor nº e Combustível (v2026.11.26.260)
- [x] Marca (`brand`) e motorização (`engine`, ex.: "1.6 · 110 cv") no veículo (migration 067): cadastro, edição e card (marca antes do modelo quando o modelo não começa com ela; motorização ao lado do ano). A busca preenche marca, modelo ("VW Crossfox", mantém a marca no modelo para listas e PDFs) e motorização (cilindrada + potência). Veículos antigos continuam com a marca dentro do modelo, sem migração de dados
- [x] Token `API_PLACAS_TOKEN` cadastrado pelo Aleph (2026-11-26)
- [x] Teste real pela função (1 consulta paga, placa de um carro já cadastrado): marca, modelo, ano, cor, combustível, cilindrada, chassi, motor e Renavam vieram; potência veio vazia; 2ª chamada saiu do cache sem cobrar. A consulta completa **também traz candidatos FIPE com score** (sem custo a mais): a função devolve `versions` e o app sugere a de maior score (se >= 50) para modelo e motorização, com botões para escolher outra ou nenhuma. Cache hit renormaliza a partir do `raw` (v2026.11.26.262)
- [x] Aleph testou a busca pela placa no app ao vivo (2026-11-26): funcionou
- [ ] Limite: chassi e motor ficam em `vehicles`, legível pela chave pública (como o resto; ver Segurança). Renavam só no cache fechado, mostrado na consulta, não gravado no veículo
- [ ] Outros cadastros de veículo (formulário rápido no card do mecânico, orçamento com veículo temporário, parceiros) ainda sem o botão
- [x] Marca separada do modelo na exibição: `VehName` (marca âmbar em maiúsculas + ponto + modelo, como no estoque) nas telas; `vehTitle` ("BMW M3 Coupe") em PDFs, links, WhatsApp, push e buscas; não repete a marca quando o modelo antigo já começa com ela. Busca pela placa grava modelo sem a marca e converte siglas (VW, GM, M.BENZ...). Conferido no link `?v=` local (v2026.11.26.263)
- [x] Marca separada do modelo nos veículos antigos (ok do Aleph, 2026-11-26): 118 de 120 (Land Rover, Mercedes-Benz, Citroën e Corvette -> Chevrolet tratados à parte). Ficaram sem marca "Caterham" e "Peças Avulsas". Backup em `~/OSC/backups/veiculos-modelo-marca-antes-2026-11-26.json`
- [x] Cadastros rápidos com todos os campos e a busca pela placa (componente `VehicleFormFields`): card do mecânico, Nova OS (cliente novo e veículo novo de cliente existente) e orçamento com veículo novo (campos extras em `quotes.temp_vehicle`, migration 068, usados ao converter em veículo). Corrigido junto: `updateQuote` não gravava nome/telefone/modelo/placa temporários ao editar orçamento (2026.11.26.264)
- [x] Marca no `VehName`: maiúsculas âmbar espaçadas em 82% do modelo, peso 600/negrito (2026.11.26.268; compensação óptica; 72% ficava pequeno e 100% parecia maior que o modelo, decisão do Aleph) (2026.11.26.267)
- [ ] Conferir no app ao vivo os três cadastros rápidos e a conversão de orçamento aprovado em veículo
- Parceiros (`partner_jobs`) guardam placa/modelo/cor do serviço do parceiro, não é cadastro de veículo: não mexido
