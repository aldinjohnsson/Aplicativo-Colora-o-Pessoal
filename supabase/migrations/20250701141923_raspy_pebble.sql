/*
  # Insert Initial Data

  1. Create first admin user (you'll need to update the email)
  2. Create sample access codes
  3. Create default contract and form content
*/

-- Insert default admin content
INSERT INTO admin_content (type, content) VALUES 
(
  'contract',
  '{
    "text": "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE DE COLORAÇÃO PESSOAL\n\n1. OBJETO\nEste contrato tem por objeto a prestação de serviços de análise de coloração pessoal, incluindo avaliação de características físicas e recomendações de paleta de cores.\n\n2. RESPONSABILIDADES DO CLIENTE\n- Fornecer informações verdadeiras no formulário\n- Enviar fotos conforme instruções específicas\n- Seguir as orientações para melhor resultado da análise\n\n3. RESPONSABILIDADES DA PRESTADORA\n- Realizar análise profissional baseada nas informações e fotos fornecidas\n- Entregar relatório completo com paleta de cores personalizada\n- Manter confidencialidade das informações do cliente\n\n4. PRAZO\nO prazo para entrega da análise é de até 5 dias úteis após o recebimento de todas as informações necessárias.\n\n5. POLÍTICA DE PRIVACIDADE\nTodas as informações e imagens fornecidas serão utilizadas exclusivamente para a análise contratada e mantidas em sigilo.\n\nAo aceitar este contrato, o cliente declara estar ciente e de acordo com todos os termos apresentados."
  }'
),
(
  'form',
  '{
    "fields": [
      {
        "id": "nome",
        "type": "text",
        "label": "Nome Completo",
        "required": true,
        "placeholder": "Digite seu nome completo"
      },
      {
        "id": "idade",
        "type": "text",
        "label": "Idade",
        "required": true,
        "placeholder": "Digite sua idade"
      },
      {
        "id": "profissao",
        "type": "text",
        "label": "Profissão",
        "required": false,
        "placeholder": "Digite sua profissão"
      },
      {
        "id": "objetivo",
        "type": "textarea",
        "label": "Qual seu objetivo com a análise de coloração?",
        "required": true,
        "placeholder": "Descreva o que espera alcançar com a análise..."
      },
      {
        "id": "experiencia",
        "type": "radio",
        "label": "Você já fez análise de coloração antes?",
        "options": ["Sim", "Não"],
        "required": true
      },
      {
        "id": "estilo",
        "type": "select",
        "label": "Como descreveria seu estilo?",
        "options": ["Clássico", "Moderno", "Casual", "Elegante", "Alternativo"],
        "required": false
      },
      {
        "id": "cores_favoritas",
        "type": "textarea",
        "label": "Quais são suas cores favoritas para usar?",
        "required": false,
        "placeholder": "Liste as cores que mais gosta de usar..."
      },
      {
        "id": "cores_evita",
        "type": "textarea",
        "label": "Há cores que você evita usar? Por quê?",
        "required": false,
        "placeholder": "Descreva cores que não gosta e o motivo..."
      }
    ]
  }'
),
(
  'instructions',
  '{
    "photo_instructions": {
      "no_makeup": {
        "title": "Foto sem Maquiagem",
        "description": "Foto natural com cabelo solto de frente para janela",
        "steps": [
          "Retire toda maquiagem do rosto",
          "Solte o cabelo naturalmente",
          "Posicione-se de frente para uma janela com luz natural",
          "Olhe diretamente para a câmera",
          "Mantenha expressão neutra"
        ]
      },
      "iris": {
        "title": "Foto da Íris",
        "description": "Close-up dos olhos para análise da cor",
        "steps": [
          "Use boa iluminação natural",
          "Foto bem próxima dos olhos",
          "Certifique-se que a íris está bem visível",
          "Evite flash direto",
          "Mantenha os olhos bem abertos"
        ]
      },
      "with_fabrics": {
        "title": "Fotos com Tecidos",
        "description": "Teste diferentes cores próximas ao rosto",
        "steps": [
          "Use tecidos ou roupas de cores diferentes",
          "Posicione próximo ao rosto e pescoço",
          "Uma foto com cores quentes",
          "Uma foto com cores frias",
          "Mantenha boa iluminação"
        ]
      }
    }
  }'
)
ON CONFLICT (type) DO NOTHING;

-- Insert some sample access codes
INSERT INTO access_codes (code) VALUES 
  ('CLIENTE001'),
  ('CLIENTE002'),
  ('CLIENTE003'),
  ('CLIENTE004'),
  ('CLIENTE005')
ON CONFLICT (code) DO NOTHING;