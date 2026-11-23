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
- [ ] **Aleph:** conferir no app ao vivo numa OS da Performance e numa da Finishing (seleção, total e PDF no celular)
- [ ] Se precisar no futuro: registrar o que já foi cobrado para não cobrar duas vezes

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
