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
- [x] Revisão do portal, bloco 3 (v2026.11.24.223): código morto removido do `ClientPortal`; cartão do Início e aba Conta usam `portalVehicleDue` (valores conferidos iguais antes/depois num cliente com 4 veículos). A página do veículo (`PublicVehicleView`, sessão do link de acompanhamento) ainda tem a própria conta
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
- [ ] **Aleph:** OS-24 da CAC8J62 tem total R$ 37.547,29 e R$ 31.000 pagos (R$ 6.547,29 em aberto no "A receber"): conferir se foi pago por fora ou se ainda deve
- [ ] Evitar repetição: "entregar" um veículo sem OS aberta cria registro vazio no histórico e leva pagamentos soltos para ele. Bloquear o fechamento sem OS / sem tarefas, ou avisar

## Segurança (sem urgência, discutir antes de mexer)
- [ ] Repositório `alephbayer/osc-performance` está público no GitHub; avaliar deixar privado
- [ ] Muitas tabelas aceitam acesso pela chave pública (`anon`) com policy `using (true)`; correção real exige Supabase Auth (mudança grande)
- [ ] Backup mensal (ou antes de mudança grande no banco): `scripts/backup.mjs` e `scripts/schema.mjs`

## Pitstop (depois)
- [ ] A edge function `manual-ask` existe só no Supabase e o Pitstop (`manual-fueltech` no Vercel) não tem repositório; guardar o código em um repositório
