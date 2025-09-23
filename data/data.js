const initData = require('./data/product.js');

const product = require('./models/product.js');





const initDB = async () => {
    await product.deleteMany({});
    let prodData = initData.map((obj) => ({...obj, owner: '68c82dd5f9b92b21f34a975d' }));
    await product.insertMany(prodData);
    console.log("Data inserted successfully");

};


module.exports = { initDB};