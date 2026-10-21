// src/lib/legalContent.ts
//
// Conteúdo dos Termos de Uso (versão Cliente e versão Consultor) e da Política
// de Privacidade. As seções são escritas UMA vez e cada página escolhe quais
// usar — a numeração é gerada automaticamente na renderização.
//
// Formato do corpo: blocos separados por linha em branco. Linhas começando com
// "- " viram lista. **texto** vira negrito.

export const LEGAL_UPDATED_AT = '21 de outubro de 2026'

export interface LegalSection {
  title: string
  body: string
}

const IDENT = `**Responsável pela plataforma:** MS Color
**CNPJ:** 43.747.151/0001-10
**Titular:** Marilia Fernanda Santos Johnsson
**Localidade:** Rio Branco do Sul, Paraná
**E-mail de contato:** marilisantoscolor@gmail.com

**Desenvolvimento técnico:** Aldinçã Ranieri Johnsson, responsável pelas atividades de desenvolvimento e manutenção técnica conforme as atribuições estabelecidas entre as partes.`

// ───────────────────────── TERMOS DE USO ─────────────────────────
export const TERMS_SECTIONS: Record<string, LegalSection> = {
  ident_cliente: {
    title: 'Identificação',
    body: `A plataforma **MS Color IA** é uma solução digital destinada ao gerenciamento de serviços de coloração pessoal, incluindo ferramentas administrativas para consultores e uma área exclusiva para os clientes atendidos.

${IDENT}

Estes Termos regulamentam o acesso e a utilização da área do cliente da plataforma.`,
  },
  ident_consultor: {
    title: 'Identificação',
    body: `A plataforma **MS Color IA** é uma solução digital destinada ao gerenciamento de serviços de coloração pessoal, incluindo ferramentas administrativas para consultores e uma área exclusiva para os clientes atendidos.

${IDENT}

Estes Termos regulamentam o acesso e a utilização da plataforma por consultores e demais usuários autorizados.`,
  },
  definicoes: {
    title: 'Definições',
    body: `Para os fins destes Termos:

**Plataforma:** sistema MS Color IA e suas funcionalidades.

**Consultor:** profissional que contrata uma assinatura para utilizar as ferramentas de gerenciamento de atendimentos.

**Cliente:** pessoa que acessa a plataforma para consultar contratos, preencher formulários, enviar informações e receber os resultados do serviço contratado.

**Assinatura:** contratação que concede ao consultor acesso aos recursos previstos no plano escolhido.

**Arquivos do atendimento:** fotografias, formulários, relatórios, resultados e demais documentos relacionados ao serviço de coloração pessoal.`,
  },
  finalidade: {
    title: 'Finalidade da plataforma',
    body: `A MS Color IA oferece recursos tecnológicos para facilitar a organização e a gestão de atendimentos de coloração pessoal.

Conforme as funcionalidades disponíveis, a plataforma poderá permitir:

- Cadastro e gerenciamento de clientes.
- Disponibilização e aceite de contratos.
- Preenchimento de formulários e envio de fotografias.
- Disponibilização de instruções para os clientes.
- Acompanhamento das etapas e dos prazos dos atendimentos.
- Organização, armazenamento e disponibilização de resultados.
- Envio de notificações por e-mail e WhatsApp.
- Acesso administrativo aos atendimentos e às funcionalidades contratadas.

Os recursos disponíveis poderão variar conforme o plano contratado e as atualizações do sistema.`,
  },
  cadastro: {
    title: 'Cadastro e acesso',
    body: `Os usuários deverão fornecer informações verdadeiras e atualizadas e manter a segurança de suas credenciais de acesso.

É proibido compartilhar acessos de forma não autorizada, tentar acessar dados de terceiros, comprometer a segurança do sistema ou utilizar a plataforma para atividades ilícitas.

Cada usuário é responsável pelas atividades realizadas por meio de sua conta, ressalvadas as responsabilidades de terceiros e as hipóteses previstas em lei.`,
  },
  condicoes_consultor: {
    title: 'Condições para consultores',
    body: `O acesso às funcionalidades administrativas depende da contratação de uma assinatura, conforme o plano escolhido.

A assinatura concede uma licença limitada de utilização dos recursos disponibilizados, durante o período contratado e nos limites estabelecidos comercialmente.

O consultor é responsável por:

a) utilizar a plataforma de acordo com estes Termos;

b) manter seus dados cadastrais atualizados;

c) informar corretamente os serviços, preços, prazos e condições oferecidos aos clientes;

d) disponibilizar contratos e orientações adequados ao atendimento;

e) obter os dados necessários à execução do serviço por meios legítimos;

f) cumprir as obrigações assumidas perante seus clientes;

g) verificar os materiais e resultados produzidos, quando aplicável à sua atividade;

h) respeitar a legislação de proteção de dados pessoais;

i) manter a confidencialidade das informações acessadas;

j) comunicar eventuais problemas técnicos que comprometam o atendimento.

A assinatura da plataforma não transfere à MS Color a responsabilidade profissional do consultor pelo serviço de coloração pessoal prestado, salvo quando houver contratação expressa em sentido diverso.`,
  },
  assinatura: {
    title: 'Assinatura, pagamento e cancelamento',
    body: `A assinatura poderá ser paga diretamente pelos meios de pagamento disponibilizados na plataforma ou por meios externos, como Pix ou outros métodos informados pela MS Color.

Os valores, a periodicidade, as funcionalidades incluídas e as condições de renovação serão apresentados no momento da contratação.

O consultor deverá observar os vencimentos e as condições do plano escolhido.

Em caso de inadimplência, o acesso às funcionalidades pagas poderá ser suspenso ou restringido, mediante comunicação quando aplicável e observância dos direitos previstos em lei.

O cancelamento deverá ser solicitado pelos canais disponibilizados. As condições de encerramento, renovação e eventual reembolso observarão a contratação e a legislação aplicável, inclusive o direito de arrependimento quando cabível.

O cancelamento da assinatura não autoriza a eliminação arbitrária de dados que devam ser conservados por obrigação legal ou para o exercício regular de direitos.`,
  },
  condicoes_cliente: {
    title: 'Condições para clientes',
    body: `A área do cliente permite acessar as funcionalidades disponibilizadas pelo consultor responsável pelo atendimento, incluindo contratos, formulários, instruções, envio de materiais e consulta dos resultados.

O cliente deverá:

a) fornecer informações verdadeiras e necessárias ao serviço;

b) seguir as instruções de envio de fotografias e demais materiais;

c) manter seus dados de contato atualizados;

d) respeitar as condições contratuais do serviço adquirido;

e) preservar a confidencialidade de seus dados de acesso;

f) consultar os prazos informados para conclusão e disponibilização dos resultados.

A utilização da plataforma não substitui a leitura do contrato firmado com o consultor.`,
  },
  contratos: {
    title: 'Contratos e aceites eletrônicos',
    body: `A plataforma poderá disponibilizar contratos e registrar o aceite dos clientes por meios eletrônicos.

Os registros poderão incluir informações sobre a data do aceite e outras evidências técnicas disponíveis no sistema.

O consultor é responsável pelo conteúdo do contrato utilizado em seu atendimento, incluindo a descrição do serviço, os valores, os prazos, as condições de entrega e as obrigações assumidas.

A disponibilização de ferramentas de aceite eletrônico não significa que a MS Color tenha elaborado ou revisado juridicamente todos os contratos utilizados pelos consultores.

A validade e a força probatória dos registros serão avaliadas conforme a legislação aplicável e as circunstâncias de cada caso.`,
  },
  prazos: {
    title: 'Prazos dos atendimentos',
    body: `O prazo de conclusão do serviço será definido pelo consultor e informado ao cliente no contrato, na área de atendimento ou em comunicação apropriada.

Quando o início da contagem depender do recebimento de formulários, fotografias ou informações completas, essa condição deverá ser informada ao cliente.

O envio incompleto ou inadequado de materiais poderá exigir correções e afetar o cronograma, desde que as condições sejam comunicadas e respeitem os direitos do cliente.

O consultor permanece responsável pelos prazos que assumir perante o cliente.`,
  },
  notificacoes: {
    title: 'Notificações por e-mail e WhatsApp',
    body: `A MS Color IA poderá enviar notificações sobre etapas do atendimento, pendências, conclusão do serviço e disponibilização dos resultados.

As mensagens serão encaminhadas aos contatos cadastrados, conforme as funcionalidades habilitadas.

A entrega das notificações depende da validade dos dados informados e da disponibilidade dos serviços de comunicação utilizados.

O usuário deverá acompanhar as informações disponíveis na plataforma e não depender exclusivamente das notificações para observar os prazos contratuais.`,
  },
  exclusao: {
    title: 'Prazo de download e exclusão automática',
    body: `O prazo para consulta e download dos resultados será definido pelo consultor e informado ao cliente no contrato, na área de atendimento ou por comunicação apropriada.

**O cliente é responsável por acessar e baixar seus arquivos dentro do prazo informado.**

Encerrado o período de disponibilização, os arquivos abrangidos pela política de expiração serão automaticamente removidos do ambiente de atendimento, conforme as funcionalidades e os procedimentos técnicos implementados na plataforma.

A exclusão poderá abranger os resultados, relatórios, fotografias e demais arquivos sujeitos ao prazo de disponibilização.

Os registros que precisem ser conservados por obrigação legal, exercício regular de direitos ou outra hipótese legítima poderão ser mantidos separadamente, com acesso restrito e pelo período necessário.

A eliminação de cópias de segurança poderá obedecer a ciclos técnicos próprios de retenção, desde que compatíveis com as obrigações legais e as medidas de segurança aplicáveis.

Após a exclusão, a recuperação dos arquivos não é garantida. O usuário deverá manter suas próprias cópias dos documentos e resultados que deseja conservar.

A expiração do prazo de download não elimina direitos legais do cliente nem autoriza a exclusão de registros cuja conservação seja obrigatória.`,
  },
  disponibilidade: {
    title: 'Disponibilidade e manutenção',
    body: `A MS Color buscará manter a plataforma funcional e segura, podendo realizar atualizações, correções e manutenções.

Poderão ocorrer interrupções temporárias por manutenção, falhas de infraestrutura, conectividade, incidentes de segurança ou indisponibilidade de fornecedores externos.

Quando viável, manutenções programadas relevantes serão comunicadas previamente.

A plataforma não garante disponibilidade ininterrupta, sem prejuízo das responsabilidades decorrentes de lei ou de obrigações contratuais específicas.`,
  },
  propriedade: {
    title: 'Propriedade intelectual',
    body: `A estrutura, o código-fonte, as interfaces, o design e os componentes próprios da plataforma são protegidos pela legislação aplicável e pertencem aos respectivos titulares de direitos.

É proibido copiar, distribuir, revender, modificar ou explorar comercialmente esses elementos sem autorização, exceto nas hipóteses permitidas por lei.

Os conteúdos inseridos por consultores e clientes permanecem sujeitos aos direitos de seus respectivos titulares. Seu tratamento técnico será realizado na medida necessária à execução das funcionalidades e conforme a Política de Privacidade.`,
  },
  privacidade: {
    title: 'Privacidade e proteção de dados',
    body: `O tratamento de dados pessoais será realizado de acordo com a Política de Privacidade da MS Color IA e com a legislação brasileira, especialmente a Lei nº 13.709/2018, Lei Geral de Proteção de Dados Pessoais (LGPD).

Os consultores deverão observar suas obrigações legais quanto à coleta, utilização, conservação e compartilhamento dos dados dos clientes.

A responsabilidade de cada parte será determinada conforme suas atividades efetivas e as funções que desempenhar no tratamento dos dados.`,
  },
  suspensao: {
    title: 'Suspensão e encerramento',
    body: `O acesso poderá ser suspenso ou encerrado em situações como fraude, uso ilícito, violação relevante destes Termos, comprometimento da segurança ou inadimplência.

Sempre que apropriado e viável, o usuário será informado sobre a medida adotada.

O encerramento da conta não elimina obrigações financeiras pendentes, deveres de confidencialidade ou a necessidade de conservar registros legalmente exigidos.

A disponibilização, exportação e eliminação de dados observarão as condições aplicáveis e a Política de Privacidade.`,
  },
  responsabilidades: {
    title: 'Responsabilidades',
    body: `Cada parte responde por suas próprias obrigações e condutas, conforme a legislação aplicável.

A MS Color não assume automaticamente a responsabilidade por análises, relatórios, prazos ou obrigações profissionais atribuíveis exclusivamente ao consultor.

O consultor não poderá transferir à plataforma as responsabilidades que assumiu perante seus clientes.

A MS Color e o desenvolvedor responderão por suas próprias atividades e obrigações nos limites aplicáveis, inclusive quanto à segurança da informação e à proteção de dados.

Nenhuma disposição destes Termos afasta direitos inderrogáveis dos consumidores ou exclui responsabilidades que não possam ser legalmente limitadas.`,
  },
  alteracoes: {
    title: 'Alterações dos Termos',
    body: `Estes Termos poderão ser atualizados em razão de alterações técnicas, operacionais, comerciais ou legais.

A versão vigente será disponibilizada na plataforma, com indicação da data da atualização. Alterações relevantes serão comunicadas quando necessário.`,
  },
  contato: {
    title: 'Contato',
    body: `Para dúvidas ou solicitações relacionadas a estes Termos:

**MS Color IA**
**E-mail:** marilisantoscolor@gmail.com`,
  },
  legislacao: {
    title: 'Legislação aplicável',
    body: `Estes Termos são regidos pela legislação brasileira.

Eventuais controvérsias serão resolvidas pelo foro competente, respeitadas as regras legais de competência e os direitos dos consumidores.

Ao utilizar a plataforma, o usuário declara estar ciente destes Termos, sem prejuízo dos direitos que lhe são assegurados por lei.`,
  },
}

export const CLIENT_TERMS_ORDER = [
  'ident_cliente', 'definicoes', 'finalidade', 'cadastro', 'condicoes_cliente',
  'contratos', 'prazos', 'notificacoes', 'exclusao', 'disponibilidade',
  'propriedade', 'privacidade', 'suspensao', 'responsabilidades',
  'alteracoes', 'contato', 'legislacao',
]

export const CONSULTANT_TERMS_ORDER = [
  'ident_consultor', 'definicoes', 'finalidade', 'cadastro', 'condicoes_consultor',
  'assinatura', 'contratos', 'prazos', 'notificacoes', 'exclusao', 'disponibilidade',
  'propriedade', 'privacidade', 'suspensao', 'responsabilidades',
  'alteracoes', 'contato', 'legislacao',
]

// ───────────────────── POLÍTICA DE PRIVACIDADE ─────────────────────
export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: 'Apresentação',
    body: `Esta Política explica como a plataforma MS Color IA trata dados pessoais durante o cadastro de usuários, o gerenciamento de assinaturas, a realização de atendimentos de coloração pessoal e a disponibilização de resultados.

A plataforma permite que consultores administrem seus atendimentos e que clientes consultem contratos, preencham formulários, enviem fotografias e recebam os resultados dos serviços contratados.

O tratamento será realizado conforme a legislação aplicável, especialmente a Lei nº 13.709/2018, Lei Geral de Proteção de Dados Pessoais (LGPD).`,
  },
  {
    title: 'Identificação',
    body: `${IDENT.replace('Responsável pela plataforma:', 'Empresa responsável pela plataforma:').replace('E-mail de contato:', 'E-mail:')}

A MS Color poderá atuar como controladora dos dados utilizados para administrar a plataforma, os cadastros, as assinaturas e o suporte.

Nos atendimentos realizados pelos consultores, estes poderão atuar como controladores dos dados de seus clientes, enquanto a MS Color poderá atuar como operadora, conforme as instruções recebidas e as atividades efetivamente realizadas.

O desenvolvedor poderá tratar dados no contexto de manutenção e suporte técnico, conforme suas atribuições e as autorizações aplicáveis.

Os papéis de controlador e operador serão definidos conforme as operações concretas de tratamento, não apenas pela denominação utilizada nesta Política.`,
  },
  {
    title: 'Dados que podem ser coletados',
    body: `**Dados dos consultores:** poderão ser tratados nome, dados cadastrais, CPF ou CNPJ quando necessários, e-mail, telefone, credenciais de acesso, informações sobre o plano contratado, pagamentos, situação da assinatura e registros de utilização.

**Dados dos clientes:** poderão ser tratados nome, telefone, e-mail, respostas a formulários, fotografias, imagens da íris quando necessárias ao serviço, informações relacionadas à coloração pessoal, contratos, registros de aceite, resultados, relatórios e documentos do atendimento.

**Dados técnicos:** conforme os recursos implementados, poderão ser tratados endereço IP, datas e horários de acesso, informações do navegador, registros de autenticação, eventos técnicos e registros de segurança.

A coleta deverá ser limitada às informações necessárias às finalidades legítimas de cada operação.`,
  },
  {
    title: 'Finalidades do tratamento',
    body: `Os dados poderão ser utilizados para:

a) criar e administrar contas;

b) gerenciar assinaturas e pagamentos;

c) disponibilizar contratos, formulários e instruções;

d) receber informações e fotografias necessárias aos atendimentos;

e) acompanhar etapas e prazos;

f) organizar e disponibilizar resultados;

g) enviar notificações por e-mail e WhatsApp;

h) prestar suporte técnico;

i) manter registros de aceites e atividades relevantes;

j) prevenir fraudes e acessos indevidos;

k) garantir a segurança e o funcionamento do sistema;

l) cumprir obrigações legais e exercer direitos.

Os dados não serão utilizados para finalidades incompatíveis com as informadas, sem fundamento legal apropriado.`,
  },
  {
    title: 'Bases legais',
    body: `O tratamento poderá se fundamentar, conforme a operação, em:

- Execução de contrato ou procedimentos preliminares relacionados a contrato.
- Cumprimento de obrigação legal ou regulatória.
- Exercício regular de direitos.
- Legítimo interesse, quando aplicável e após a avaliação necessária.
- Consentimento, quando exigido ou adequado à finalidade.

Para dados pessoais sensíveis, deverão ser observadas as hipóteses específicas previstas na LGPD. A base legal será definida conforme a natureza do dado e a finalidade efetiva do tratamento.`,
  },
  {
    title: 'Fotografias e imagens da íris',
    body: `As fotografias poderão incluir imagens do cabelo, do rosto ou da íris, conforme o serviço contratado.

Essas imagens poderão ser utilizadas pelo consultor para realizar a análise de coloração pessoal, preparar o relatório e produzir os resultados contratados.

Fotografias identificáveis são dados pessoais. Imagens da íris poderão constituir dados pessoais sensíveis biométricos quando tratadas para identificar uma pessoa de maneira única.

O envio de uma fotografia para a análise não autoriza automaticamente sua publicação em redes sociais, anúncios, portfólios ou outros materiais promocionais.

O uso para publicidade, treinamento de inteligência artificial ou finalidades distintas do atendimento deverá ser avaliado separadamente, com fundamento legal apropriado e as informações ou autorizações exigíveis.`,
  },
  {
    title: 'Compartilhamento de dados',
    body: `Os dados poderão ser compartilhados, na medida necessária, com:

a) o consultor responsável pelo atendimento;

b) fornecedores de hospedagem e infraestrutura;

c) fornecedores de serviços de e-mail e WhatsApp;

d) prestadores de autenticação, segurança, manutenção e suporte;

e) processadores de pagamento;

f) autoridades públicas, quando houver obrigação ou fundamento legal.

Os fornecedores deverão ter acesso apenas às informações necessárias à prestação de seus serviços, observadas as medidas de segurança e as obrigações aplicáveis.

A MS Color não comercializa dados pessoais como produto independente.`,
  },
  {
    title: 'Armazenamento e transferência internacional',
    body: `A plataforma adota o **Brasil como local previsto para o armazenamento principal dos dados**, conforme a infraestrutura contratada e utilizada.

A localização efetiva dos dados, inclusive cópias de segurança, deverá corresponder à configuração dos fornecedores e dos serviços utilizados.

Alguns serviços de comunicação, infraestrutura, processamento ou suporte poderão realizar operações de tratamento a partir de outros países ou envolver transferências internacionais.

Quando houver transferência internacional de dados pessoais, deverão ser observados os requisitos da LGPD e as normas aplicáveis da Autoridade Nacional de Proteção de Dados (ANPD).`,
  },
  {
    title: 'Notificações por e-mail e WhatsApp',
    body: `A plataforma poderá enviar mensagens relacionadas a cadastro, pendências, andamento do atendimento, conclusão do serviço e disponibilidade dos resultados.

As notificações serão encaminhadas aos contatos cadastrados, conforme as funcionalidades habilitadas.

A entrega depende da validade dos dados e da disponibilidade dos serviços utilizados. O usuário deverá manter suas informações atualizadas.

As notificações operacionais não equivalem automaticamente a autorização para publicidade. Comunicações promocionais deverão observar os requisitos legais aplicáveis.`,
  },
  {
    title: 'Prazo de download e exclusão automática',
    body: `O prazo de acesso e download dos resultados será definido pelo consultor responsável pelo atendimento e informado ao cliente no contrato, na área de atendimento ou em comunicação apropriada.

O cliente será responsável por baixar seus resultados e guardar cópias dos arquivos que deseja conservar antes do vencimento do prazo.

**Encerrado o prazo definido pelo consultor, os arquivos sujeitos à expiração serão automaticamente excluídos do ambiente de atendimento, conforme as regras técnicas implementadas na plataforma.**

A política de exclusão poderá abranger fotografias, formulários, relatórios, resultados e outros arquivos vinculados ao atendimento que estejam sujeitos ao prazo de disponibilização.

A exclusão dos arquivos de atendimento não implica necessariamente a eliminação imediata de todos os registros relacionados à operação. Contratos, comprovantes de aceite, registros financeiros, documentos e informações que precisem ser conservados por obrigação legal ou para o exercício regular de direitos poderão ser mantidos separadamente, com acesso restrito e pelo período necessário.

Cópias de segurança poderão permanecer temporariamente sujeitas aos ciclos técnicos de retenção, desde que isso seja compatível com a legislação e com as medidas de segurança aplicáveis.

Após a exclusão definitiva, a recuperação dos arquivos não é garantida.

O prazo de download é distinto do prazo legal de conservação de documentos e registros.`,
  },
  {
    title: 'Prazos de retenção',
    body: `Os dados serão mantidos durante o período necessário às finalidades informadas e às obrigações aplicáveis.

Os arquivos de atendimento sujeitos à expiração seguirão o prazo definido pelo consultor.

Os contratos, comprovantes de aceite e demais registros que devam ser preservados poderão ser conservados pelo tempo necessário ao cumprimento de obrigações legais ou ao exercício regular de direitos.

Os dados cadastrais e financeiros relacionados às assinaturas poderão ser conservados durante a relação contratual e pelo período adicional legalmente necessário.

Registros técnicos e de segurança poderão ser mantidos pelo período exigido pela legislação ou necessário às finalidades legítimas correspondentes.

Encerrada a finalidade e inexistindo fundamento para a conservação, os dados deverão ser eliminados ou submetidos a outra medida legalmente adequada.`,
  },
  {
    title: 'Segurança da informação',
    body: `A MS Color adotará, dentro de suas atribuições, medidas técnicas e administrativas adequadas aos riscos do tratamento.

Essas medidas poderão incluir controle de acesso, autenticação, proteção de credenciais, conexões seguras, atualizações, registros de segurança e mecanismos de cópia de segurança e recuperação, conforme os recursos efetivamente implementados.

Nenhum sistema garante segurança absoluta. Ainda assim, deverão ser adotadas medidas razoáveis de prevenção, proteção e resposta a incidentes.

Os consultores também deverão proteger as contas e as informações de seus clientes e limitar o acesso aos dados às pessoas autorizadas.`,
  },
  {
    title: 'Direitos dos titulares',
    body: `Nos termos da LGPD, os titulares poderão solicitar, conforme aplicável:

a) confirmação da existência de tratamento;

b) acesso aos dados pessoais;

c) correção de dados incompletos, inexatos ou desatualizados;

d) informações sobre o compartilhamento de dados;

e) anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei;

f) eliminação dos dados tratados com consentimento, ressalvadas as hipóteses legais de conservação;

g) revogação do consentimento, quando aplicável;

h) informações sobre a possibilidade de não fornecer consentimento e suas consequências;

i) demais direitos previstos na legislação.

O atendimento poderá exigir a confirmação da identidade do solicitante e a análise das obrigações legais de conservação.

Nem todos os dados poderão ser eliminados imediatamente, especialmente quando houver obrigação legal de guarda ou necessidade de conservação para o exercício regular de direitos.`,
  },
  {
    title: 'Canal para solicitações de privacidade',
    body: `As solicitações relacionadas à privacidade poderão ser encaminhadas para:

**MS Color IA**
**E-mail:** marilisantoscolor@gmail.com

Quando o pedido envolver dados de um atendimento gerenciado por um consultor, poderá ser necessário encaminhá-lo ao profissional responsável pelo tratamento correspondente.

A MS Color avaliará as solicitações relativas às operações pelas quais for responsável e orientará o titular sobre o canal apropriado quando necessário.`,
  },
  {
    title: 'Cookies e tecnologias semelhantes',
    body: `A plataforma poderá utilizar cookies ou tecnologias semelhantes para manter sessões, preservar preferências, reforçar a segurança e, caso implementadas, analisar a utilização do sistema.

As tecnologias efetivamente utilizadas deverão ser informadas de acordo com a configuração real da plataforma.

Cookies não essenciais deverão observar a legislação aplicável e as escolhas exigíveis do usuário.`,
  },
  {
    title: 'Dados de crianças e adolescentes',
    body: `Caso sejam tratados dados de crianças ou adolescentes, deverão ser observadas as regras específicas da LGPD e o princípio do melhor interesse.

Quando necessário, deverão ser adotadas medidas apropriadas para verificar a representação legal e obter as autorizações exigidas.`,
  },
  {
    title: 'Alterações desta Política',
    body: `Esta Política poderá ser atualizada para refletir mudanças técnicas, operacionais, contratuais ou legais.

A versão vigente será disponibilizada na plataforma, com indicação da data de atualização. Alterações relevantes serão comunicadas quando necessário.`,
  },
  {
    title: 'Legislação aplicável',
    body: `Esta Política é regida pela legislação brasileira, especialmente pela Lei nº 13.709/2018, Lei Geral de Proteção de Dados Pessoais (LGPD).

O tratamento deverá observar os princípios e as obrigações legais aplicáveis, incluindo finalidade, adequação, necessidade, transparência, segurança e prevenção.

A ciência desta Política não substitui a obtenção de consentimento específico quando ele for exigido pela legislação.`,
  },
]
