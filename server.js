require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configurações da Shopify usando variáveis de ambiente
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

// Configurações da API do Hugging Face
const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Variáveis para armazenar os valores do frontend
let descriptionTemplate = '';
let pageTitleTemplate = '';
let metadescriptionTemplate = '';
let generatedTags = [];

// Servir o arquivo index.html
app.use(express.static(path.join(__dirname, 'public')));

// Rota para receber dados do frontend
app.post('/update-product', (req, res) => {
    descriptionTemplate = req.body.description;
    pageTitleTemplate = req.body.pageTitle;
    metadescriptionTemplate = req.body.metadescription;
    console.log('Dados recebidos do frontend:', { descriptionTemplate, pageTitleTemplate, metadescriptionTemplate });
    res.json({ success: true });
});

// Rota para o webhook de criação de produtos
app.post('/webhook/products/create', async (req, res) => {
    const product = req.body;
    console.log('Novo produto detectado:', product);

    // Verificar se o produto já foi atualizado
    try {
        const metafieldsResponse = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products/${product.id}/metafields.json`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
            }
        });

        const updatedMetafield = metafieldsResponse.data.metafields.find(metafield => metafield.namespace === 'global' && metafield.key === 'updated');

        if (updatedMetafield && updatedMetafield.value === 'true') {
            console.log(`Produto ID: ${product.id} já foi atualizado anteriormente.`);
            return res.status(200).send('Produto já atualizado anteriormente');
        }
    } catch (error) {
        console.error('Erro ao verificar metafields:', error.response ? error.response.data : error.message);
        return res.status(500).send('Erro ao verificar metafields');
    }

    // Substituir variáveis no template
    const title = product.title;
    const titleUpperCase = title.toUpperCase();

    const description = descriptionTemplate
        .replace(/\$tituloCAP/g, titleUpperCase)
        .replace(/\$titulo/g, title)
        .replace(/\n/g, '<br>');

    const pageTitle = pageTitleTemplate.replace(/\$tituloCAP/g, titleUpperCase).replace(/\$titulo/g, title);
    const metadescription = metadescriptionTemplate.replace(/\$tituloCAP/g, titleUpperCase).replace(/\$titulo/g, title);

    // Atualizar metadados do produto
    try {
        console.log(`Atualizando produto ID: ${product.id}`);
        await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products/${product.id}.json`, {
            product: {
                body_html: description || product.body_html,
                metafields: [
                    {
                        namespace: 'global',
                        key: 'description_tag',
                        value: metadescription || '',
                        type: 'single_line_text_field'
                    },
                    {
                        namespace: 'global',
                        key: 'title_tag',
                        value: pageTitle || '',
                        type: 'single_line_text_field'
                    },
                    {
                        namespace: 'global',
                        key: 'updated',
                        value: 'true',
                        type: 'single_line_text_field'
                    }
                ]
            }
        }, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('Produto atualizado com sucesso');
        res.status(200).send('Produto atualizado com sucesso');
    } catch (error) {
        console.error('Erro ao atualizar produto:', error.response ? error.response.data : error.message);
        res.status(500).send('Erro ao atualizar produto');
    }
});

// Rota para atualizar o texto alternativo das imagens
app.post('/update-alt-text', async (req, res) => {
    try {
        // Obter o último produto adicionado
        const productsResponse = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products.json?limit=1&order=created_at desc`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
            }
        });

        const product = productsResponse.data.products[0];
        const title = product.title;

        // Atualizar o texto alternativo de cada imagem
        const updatedImages = product.images.map((image, index) => ({
            id: image.id,
            alt: `${title} - EUPHORE, Foto ${index + 1}`
        }));

        await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products/${product.id}.json`, {
            product: {
                images: updatedImages
            }
        }, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('Texto alternativo das imagens atualizado com sucesso');
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao atualizar texto alternativo:', error.response ? error.response.data : error.message);
        res.json({ success: false });
    }
});

// Rota para gerar tags para SEO
app.post('/generate-tags', async (req, res) => {
    try {
        // Importação dinâmica do node-fetch
        const fetch = (await import('node-fetch')).default;

        // Obter o último produto adicionado
        const productsResponse = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products.json?limit=1&order=created_at desc`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
            }
        });

        const product = productsResponse.data.products[0];
        const description = product.body_html;

        // Chamar a API do Hugging Face para gerar tags
        const response = await fetch('https://api-inference.huggingface.co/models/facebook/bart-large-mnli', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: description,
                parameters: {
                    candidate_labels: [
                        "Material: Bolsa de Couro",
                        "Cor: Bolsa Preta",
                        "Cor: Bolsa Marrom",
                        "Funcionalidade: Bolsa de Ombro",
                        "Funcionalidade: Bolsa para o Dia a Dia",
                        "Tamanho: Bolsa Grande",
                        "Tamanho: Bolsa Compacta",
                        "Marca: EUPHORE"
                    ]
                }
            })
        });

        const data = await response.json();
        generatedTags = data.labels.map(label => label.split(': ')[1]).slice(0, 5); // Remover a categoria e limitar a 5 tags

        console.log('Tags geradas:', generatedTags);
        res.json({ success: true, tags: data.labels });
    } catch (error) {
        console.error('Erro ao gerar tags:', error);
        res.json({ success: false });
    }
});

// Rota para aplicar tags ao produto
app.post('/apply-tags', async (req, res) => {
    try {
        // Obter o último produto adicionado
        const productsResponse = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products.json?limit=1&order=created_at desc`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
            }
        });

        const product = productsResponse.data.products[0];

        // Obter as tags atuais do produto
        const currentTags = product.tags ? product.tags.split(', ') : [];

        // Combinar as tags atuais com as novas, evitando duplicatas
        const allTags = Array.from(new Set([...currentTags, ...generatedTags]));

        // Atualizar o produto com todas as tags
        await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/products/${product.id}.json`, {
            product: {
                tags: allTags.join(', ')
            }
        }, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        console.log('Tags aplicadas ao produto:', allTags);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao aplicar tags:', error);
        res.json({ success: false });
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
