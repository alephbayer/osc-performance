# OSC Group — sistema de gestão (PWA)

Sistema da oficina OSC Group (OSC Performance + OSC Finishing Division). A empresa inteira roda aqui: OSs, clientes, estoque, compras, financeiro, portal do cliente. **Trate cada mudança como produção.**

## Antes de começar
- **Leia `PENDENCIAS.md`** (o que ficou em aberto) e atualize-o ao terminar. Uma conversa por assunto: o contexto vem deste arquivo, não da memória do chat.

## Quem e como
- Dono/operador e desenvolvedor: Aleph. Fala português; quer respostas **curtas e diretas**.
- Estética: minimalista, tipografia espaçada, fontes finas, **fonte menor antes de mexer em espaçamento**, ícones de traço (stroke), **sem emojis na interface**.
- Nunca peça nem cole segredos no chat (senhas, chaves, tokens). Eles vivem só nos secrets do Supabase e nas variáveis do Vercel.

## Arquitetura
- Front: React 18 + Vite. **Quase tudo em `src/App.jsx`** (~20 mil linhas) + `src/supabase.js` (camada de acesso ao banco, objeto `db`). Procure por nome de função/componente (grep), não por número de linha.
- Backend: Supabase, projeto `lchfmoeyzgbepunetuch` (plano grátis, **sem backup automático** — ver "Backup"). Storage: buckets `photos`, `portfolio`.
- Edge functions em `supabase/functions/`: `ml-sync` (Mercado Livre), `send-push`, `read-invoice` (leitura de nota por IA), `ai-quote`, `appointment-reminders` (cron diário), `shorten-url`. A `manual-ask` pertence ao app Pitstop (repositório próprio).
- Deploy: Vercel, projeto `osc-performance`, **automático a cada push na `main`** (GitHub `alephbayer/osc-performance`). Não há staging: um push vai direto para a produção.
- PWA com service worker (`public/sw.js`) e tela de "atualização disponível" baseada em `public/version.json`.

## Fluxo de cada mudança (obrigatório)
1. Editar o código.
2. **Registrar no changelog** (ver abaixo) e **subir a versão** (formato `AAAA.MM.DD.N`) nos 3 lugares: `src/App.jsx` (`APP_VERSION`), `index.html`, `public/version.json`. Ex.: `sed -i "s/2026.11.19.193/2026.11.19.194/g" src/App.jsx index.html public/version.json`.
   - **No macOS** o `sed -i` exige aspas vazias: `sed -i '' "s/ANTIGA/NOVA/g" src/App.jsx index.html public/version.json`.
3. `npm run build` — tem que passar.
4. `git add -A && git commit` (mensagem em português, curta e objetiva) e `git push origin HEAD:main` (com retry se falhar).
5. Avisar o Aleph para **fechar e reabrir o app** para atualizar.
6. Dizer com honestidade o que foi verificado: normalmente **build e PDFs de teste, não o app ao vivo**.
- **A cada mudança visível ao usuário, acrescente uma linha em `public/changelog.json`** (mais recente primeiro; agrupe por data de hoje; `type`: `feat` ou `fix`; texto curto em português, sem emoji, do ponto de vista de quem usa o app). O Aleph pediu para manter isso a cada mudança. Última atualização completa: 2026-11-19.

## Banco de dados
- Mudanças de schema: migration via Supabase (`apply_migration`) **e** arquivo `migration_NNN_nome.sql` na raiz do repositório (a última é a 057). Migrations antigas (até ~039) nem todas refletem o banco real: a fonte de verdade é o banco.
- RLS está ativo, mas muitas policies são permissivas (`using (true)`). Não depender de RLS para esconder dados: a ocultação de valores por perfil é feita **na interface**.
- Edge functions: ao redeployar, enviar o arquivo **completo**. `ml-sync` e a maioria exigem JWT; confira antes de mudar.
- A tabela `admin_push_subscriptions` tem check de `role` (owner, admin, supervisor, painter). Novo perfil exige atualizar o check.

## Perfis de acesso (login por senha; `ROLE_CONFIG` em `App.jsx`)
| Perfil | Rótulo | Vê |
|---|---|---|
| `owner` | Gestor | tudo, inclusive Financeiro |
| `admin` | Administrativo | tudo, exceto Financeiro |
| `supervisor` | Chefe de Oficina | Mecânicos (Performance), Estoque, Investimentos, Materiais, Presenças, Parceiros, Patrimônio — **sem valores** |
| `painter` | Chefe de Pintura | Finishing (carros em andamento), Estoque, Investimentos, Materiais, Presenças, Parceiros, Patrimônio — **sem valores** |

- Senhas: variáveis do Vercel `VITE_OWNER_PASSWORD`, `VITE_ADMIN_PASSWORD`, `VITE_SUPERVISOR_PASSWORD`, `VITE_PAINTER_PASSWORD`, cada uma com o **hash SHA-256** da senha (gerado com `printf '%s' 'SENHA' | shasum -a 256`). Mudou a variável → precisa redeploy. Também existe `VITE_VAPID_PUBLIC_KEY`.
- Chefes nunca veem valores. Use o helper `isChief(role)` (supervisor e painter) e `managerMode` (só owner/admin) no `VehicleCard`. Ao criar telas novas, pergunte: "um chefe pode ver esse número?".

## Secrets das edge functions (só nomes — valores ficam no Supabase)
`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `ANTHROPIC_API_KEY`, `ANTHROPIC_KEY_MANUAL` (+ as padrão do Supabase).

## PDFs de orçamento
- Motor: `renderElegantQuote` em `App.jsx` (jsPDF 2.5.1, A4 em mm, margem 20). Compartilhado por Performance e Finishing; modo "Ficha" (`featList`) gera capa sem valores → detalhamento por serviço → investimento e condições → aceite → página de fechamento com o logo.
- (macOS: o `pdftoppm` vem do `poppler`: `brew install poppler`.)
- **Teste sem abrir o app:** `npm i --no-save jspdf@2.5.1 && node scripts/pdf-test.cjs saida.pdf`, depois `pdftoppm -r 70 -png saida.pdf pag` e **olhe cada página**. Teste Performance e Finishing, prazo curto e longo.
- Regras fixas: observação de que prazos e valores podem variar; **não alterar os nomes das contas/formas de pagamento**; peças importadas com nota explicando o cálculo (câmbio, impostos, frete, taxa do importador, garantia de recebimento); cliente não vê cotação nem percentuais, só valor na moeda original e valor final em reais; só serviços cobrados aparecem (tarefa sem valor é interna; garantia aparece como cortesia).

## Regras de negócio que o Aleph definiu
- **Mercado Livre:** uma conta compra; pedido guarda o link do anúncio. Item só entra no estoque/destino quando o ML marca entregue **e** o administrador confere e confirma — nunca automático. Carro/serviço vindo de pedido por link é só **sugestão**; o administrador confirma. Compra com 2+ unidades pode ser destinada em partes. Destino "Devolução" é só controle interno (prazo padrão de 7 dias). Chefes veem as entregas do ML, sem valores. Singular/plural valem igual nas comparações por sinônimo; cuidado com medidas diferentes.
- **Finishing:** peças compradas para a Finishing são pagas pela Performance, lançadas na OS da Finishing, com acerto interno automático valorizado a preço de venda.
- **Estoque:** busca por palavra-chave; alerta "Baixo" só se quantidade < mínima (mínimo 0 nunca alerta); nomes só com a 1ª letra maiúscula, marca em campo próprio exibida antes do nome; "inox" como etiqueta; o'ring escrito assim.
- **Ferramentas → "Patrimônio":** entram como investimento, sem abater o lucro do mês. Insumos entram como custo do mês da compra.
- **Mão de obra:** ao fechar, costuma-se cobrar 50% da MO. Mudar a MO padrão por hora **nunca** altera OSs/tarefas antigas.
- A oficina trabalha com o dinheiro do cliente: peças cobradas de OS aberta contam como compradas.
- Painel "A receber" é só do gestor. Botão "+" flutuante está oculto de propósito.

## Backup e recuperação
- O plano grátis do Supabase não faz backup. Rode periodicamente no computador do Aleph: `SUPABASE_SERVICE_ROLE_KEY="..." node scripts/backup.mjs` (tabelas em JSON + todo o Storage) e `... node scripts/schema.mjs` (schema.sql). Guardar o zip em local privado (tem dados de clientes e o token do ML). Depois **limpar a chave do histórico do terminal**.
- O que existe só fora do Git: dados do Supabase, fotos do Storage, valores dos secrets e das variáveis do Vercel. Perder qualquer um deles é irreversível sem backup.

## Cuidados
- Mudou algo de dinheiro, estoque ou perfil? Teste o caso de borda e diga o que não foi testado.
- Não rodar `npm audit fix --force`.
- Não commitar segredos nem o conteúdo de `backup-*/`.
