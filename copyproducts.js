const axios = require('axios');
const fs = require('fs');

const sourceStore = {
    url: 'https://api.bigcommerce.com/stores/ml8m0dw2le/v3/catalog',
    token: 'nvy2q65q8n8qqqsj31kukzjrq5t5ok1',
};

const targetStore = {
    url: 'https://api.bigcommerce.com/stores/72659iqkvs/v3/catalog',
    token: 'lyruypypoz77asfbnbvjlz3nu04wpl1',
};

async function getProductsFromSource() {
    const config = {
        headers: { 'X-Auth-Token': sourceStore.token },
    };
    const response = await axios.get(`${sourceStore.url}/products?include=custom_fields,images`, config);
    return response.data.data;
}

async function getCategoriesFromSource() {
    const config = {
        headers: { 'X-Auth-Token': sourceStore.token },
    };
    const response = await axios.get(`${sourceStore.url}/categories`, config);
    return response.data.data;
}

async function getCategoriesFromTarget() {
    const config = {
        headers: { 'X-Auth-Token': targetStore.token },
    };
    const response = await axios.get(`${targetStore.url}/categories`, config);
    return response.data.data;
}

function buildCategoryMap(sourceCategories, targetCategories) {
    let categoryMap = {};
    sourceCategories.forEach(sourceCategory => {
        const targetCategory = targetCategories.find(targetCategory => targetCategory.name === sourceCategory.name);
        if (targetCategory) {
            categoryMap[sourceCategory.id] = targetCategory.id;
        }
    });
    return categoryMap;
}

async function postCategory(category) {
    const config = {
        headers: {
            'X-Auth-Token': targetStore.token,
            'Content-Type': 'application/json',
        },
    };

    const newCategory = { 
        name: category.name, 
        parent_id: category.parent_id || 0,
    };
    
    const existingCategory = await findCategoryInTarget(category.name, newCategory.parent_id);
    
    if (existingCategory) {
        console.log(`Category ${category.name} already exists, skipping.`);
        return existingCategory.id; // return existing category id
    }

    const response = await axios.post(`${targetStore.url}/categories`, newCategory, config);
    console.log(`Posted category ${category.name}, response status: ${response.status}`);
    
    return response.data.data.id;
}

async function findCategoryInTarget(name, parentId) {
    const config = {
        headers: {
            'X-Auth-Token': targetStore.token,
            'Content-Type': 'application/json',
        },
    };
    
    const response = await axios.get(`${targetStore.url}/categories`, config);
    const categories = response.data.data;
    
    return categories.find(category => category.name === name && category.parent_id === parentId);
}

async function postCategoriesToTarget(categories, categoryMap) {
    for (let category of categories) {
        if (category.parent_id) {
            category.parent_id = categoryMap[category.parent_id]; // remap parent id
        }
        const newId = await postCategory(category);
        // Map source id to new id
        categoryMap[category.id] = newId;
    }
}

async function postProductsToTarget(products) {
    const config = {
        headers: {
            'X-Auth-Token': targetStore.token,
            'Content-Type': 'application/json',
        },
    };
    let isFirstProduct = true;
    for (const product of products) {
        // exclude read-only fields
        delete product.id;
        delete product.date_created;
        delete product.date_modified;
        delete product.calculated_price;
        delete product.base_variant_id;

        // remove 'id' from custom_fields
        if (product.custom_fields) {
            product.custom_fields.forEach(field => {
                delete field.id;
            });
        }

        // prepare image data, exclude read-only fields and keep necessary ones only
        if (product.images) {
            product.images = product.images.map(image => {
                return {
                    image_url: image.url_standard, // replaced image_file with image_url and used url_standard
                    is_thumbnail: image.is_thumbnail,
                    description: image.description,
                    sort_order: image.sort_order,
                }
            });
        }

        // write the first product data to a JSON file
        if (isFirstProduct) {
            fs.writeFileSync('firstProduct.json', JSON.stringify(product, null, 2));
            isFirstProduct = false;
        }

        const response = await axios.post(`${targetStore.url}/products`, product, config);
        console.log(`Posted product ${product.name}, response status: ${response.status}`);
    }
}

// Main function to copy products
async function copyProducts() {
    const [products, sourceCategories, targetCategories] = await Promise.all([
        getProductsFromSource(),
        getCategoriesFromSource(),
        getCategoriesFromTarget(),
    ]);

    // Map existing categories
    const categoryMap = buildCategoryMap(sourceCategories, targetCategories);
    
    // Post all categories (including new and subcategories)
    await postCategoriesToTarget(sourceCategories, categoryMap);
    
    // Update product categories
    for (let product of products) {
        product.categories = product.categories.map(categoryId => categoryMap[categoryId]).filter(id => id !== undefined);
    }
    // Post products
    await postProductsToTarget(products);
}

copyProducts().catch(console.error);
