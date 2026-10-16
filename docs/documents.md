# Documentos e assinatura eletrônica

O módulo `/documents` permite criar textos simples, importar TXT, preencher
campos de PDFs e adicionar textos posicionados nas páginas. PDFs têm limite de
10 MB e 100 páginas. Não substitui texto existente, não faz OCR e não importa
DOCX. A fonte de exportação suporta português e caracteres latinos; caracteres
não suportados são rejeitados com uma mensagem, nunca removidos silenciosamente.

## Ativação

1. Use Node.js 22.13 ou superior e execute `npm ci`.
2. Aplique `supabase/migrations/039_documents.sql` no SQL Editor do projeto
   Supabase usado pela aplicação, após as migrações anteriores. Em seguida,
   aplique `040_document_owner_signature.sql` para habilitar a assinatura padrão.
3. Reinicie `npm run dev` ou faça o build/deploy habitual.

A migração cria `documents`, `document_versions` e o bucket **privado**
`documents`. Não é necessário cadastrar um provedor de assinatura. As credenciais
Supabase existentes são utilizadas. A chave de serviço permanece no servidor.

## Uso

- Crie um documento ou importe PDF/TXT na área Documentos do menu.
- Edite o texto, os campos do formulário ou as anotações do PDF. Clique na
  prévia para posicionar um texto; os controles de página e porcentagem também
  permitem ajustar a posição sem clicar no PDF.
- Ao finalizar o conteúdo, clique em **Documento pronto — continuar**.
  As alterações são salvas antes de avançar para a configuração de assinaturas.
- Informe o nome do cliente e clique em **Posicionar cliente**, depois na página.
  Arraste a área para mover e seu canto azul para redimensionar. Setas também
  movem a área; Alt + setas redimensionam. As coordenadas acompanham o recorte
  e a rotação da página. Use Anterior/Próxima para posicionar em outra página.
- Opcionalmente, **Carregar assinatura padrão** inclui o desenho autorizado
  do dono. A área pode ser posicionada independentemente da assinatura do cliente.
- Clique em **Apresentar ao cliente**. O sistema salva as posições e exibe o
  PDF em uma área de leitura, sem os campos de edição. Depois da revisão,
  clique em **Solicitar assinatura do cliente** e entregue a tela para ele
  desenhar e confirmar a leitura presencialmente.
- Baixe o PDF final ou versões anteriores pelo histórico.

### Modelos reutilizáveis

Na aba **Modelos**, use **Novo modelo** ou importe um PDF/TXT. Também é possível
abrir um documento salvo e usar **Salvar como modelo** para criar uma cópia.
Substitua dados de clientes por marcadores, por exemplo `{{nome_cliente}}`,
`{{email_cliente}}`, `{{cpf}}`, `{{endereco}}` e `{{valor}}`.
Em PDFs, os marcadores funcionam nos campos preenchíveis e textos adicionados;
o texto impresso no PDF original não é substituído automaticamente.

**Usar modelo** solicita os campos encontrados e cria um novo rascunho para
o cliente. Nome e e-mail do cliente alimentam também os marcadores correspondentes.
Os outros marcadores podem ser personalizados com letras, números e sublinhados.
O modelo continua disponível para novas cópias. Assinaturas, identidade do cliente
anterior e autorização do dono não são reaproveitadas na cópia. Os originais de
PDF são imutáveis e compartilhados apenas entre documentos da mesma conta.

Modelos e documentos com marcadores pendentes não podem ser assinados. O recurso
usa o campo JSON existente dos documentos e não exige uma migração adicional.

A assinatura é do **cliente presente**, com nome e e-mail (opcional) declarados,
confirmação expressa, data/hora UTC, versão e SHA-256 do conteúdo junto à
referência hash do PDF original. O usuário autenticado é registrado separadamente
como responsável pela coleta, não como identidade autenticada do cliente.
O desenho aparece na posição escolhida e numa página adicional de registro.
Não existem links públicos de assinatura. Documentos antigos já assinados
mantêm seu registro original e seus bytes. Não é assinatura
criptográfica PAdES/ICP-Brasil, não tem certificado digital, carimbo do tempo
externo ou verificação independente da identidade civil. Não deve ser
apresentada ao usuário como tal.

### Assinatura padrão e editor

Em **Configurações → Assinatura de documentos**, somente o dono atual pode
cadastrar seu desenho e autorizar expressamente o uso pelos editores da conta.
A identidade do dono vem da sessão, nunca do formulário. Cada alteração muda a
versão da autorização. Desativar impede novas finalizações; o banco verifica a
autorização na transação de assinatura para fechar a corrida entre revogar e
assinar. Uma transferência de conta invalida a assinatura do dono anterior.
Documentos finalizados não são modificados por essas mudanças.

Novos textos e rascunhos atualizados usam Roboto incorporada ao PDF, com a mesma
fonte, largura A4 e margens do editor. O editor é um fluxo contínuo; a prévia
mostra a paginação final e atualiza automaticamente após uma breve pausa.
Prévia ao vivo não cria versões nem autoriza assinatura: é necessário salvar
e carregar novamente o PDF salvo. Versões legadas continuam com seu layout antigo.

## Integridade e acesso

- Visualizadores podem consultar e baixar; agentes, administradores e donos
  podem criar, editar e assinar documentos da própria conta.
- Não existem URLs públicas nem políticas de escrita direta pelo navegador.
  As rotas verificam sessão, papel, conta e identidade em cada operação.
- Toda mudança gera uma versão na mesma transação, por trigger.
- A atualização compara a revisão esperada: alterações simultâneas são
  rejeitadas, incluindo disputas entre edição e assinatura.
- O documento assinado é bloqueado por trigger e pela API. Seus bytes são
  guardados, nunca regenerados para download, e o hash é conferido ao baixar.
- O original permanece privado. Formulários ficam editáveis nos rascunhos;
  a cópia assinada tem seus campos incorporados ao conteúdo estático.
- PDFs protegidos por senha, com XFA ou campos de assinatura digital são
  rejeitados, evitando modificar arquivos que já possam ter sido assinados.
- O registro é protegido pelas permissões do CRM, não contra um administrador
  que tenha acesso total ao banco/armazenamento. Backups continuam necessários.
- Em caso de resposta incerta do banco após um upload, o arquivo privado é
  preservado para não apagar um documento cuja gravação possa ter concluído.
  Arquivos sem referência podem ser reconciliados posteriormente por um
  administrador; conflitos de revisão confirmados removem o upload descartado.

O histórico mostra as últimas 100 versões; versões mais antigas continuam no
banco e podem ser baixadas pela rota autenticada com o número de revisão.

## Verificação

`npm test -- src/lib/documents` cobre PDF, validação, isolamento entre contas,
revisões e imutabilidade usando PostgreSQL local em memória (PGlite).
Os testes não acessam o banco de produção nem assinam documentos reais.
