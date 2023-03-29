require('dotenv').config();
const cors = require('cors');
const express = require('express');
const fileUpload = require('express-fileupload');
const TeachableMachine = require("@sashido/teachablemachine-node");

const app = express();
const env = process.env
const IP = env.IP || 'localhost';
const PORT = env.PORT || 8080;
const appIP = env.appIP || 'localhost:4200';

//middleware
app.use(express.urlencoded({ extended : true, }));
app.use(express.static('public'));
app.use(express.json());
app.use(
    fileUpload({
        limits: {
            fileSize: 10000000,
        },
        abortOnLimit: true,
    })
);
app.use(cors({
    origin: [
        `http://${appIP}`
    ], 
    credentials: true
}));

app.get('/ingredients', async (req, res, next)=>{     
    let ingredients = await getAllIngredients();  
    res.json(ingredients);
})

app.post('/product/imagerecognition', async(req, res, next)=>{
    //get image and allergens
    const img = req.files.img;
    let allergens = req.body.allergens;

    //save img
    // If no image submitted, exit
    if (!img) 
        return res.status(400).json({error: 'no image found'});

    console.log(img)
 
    // Move the uploaded image to our upload folder
    await img.mv(__dirname + '/uploads/' + img.name);

    //save image as url
    let url = getUrlFromImg(img)

    //load model
    let prediction;

    const model = new TeachableMachine({
        modelUrl: env.model || "https://teachablemachine.withgoogle.com/models/aPCNH0JtA/"
    });

    await model.classify({
    imageUrl: url,
    }).then(async (predictions) => {
        console.log("Predictions:", predictions);
        //get highest value
        prediction = predictions[0]

        // check if highest value is greater that 0.7
        if(prediction.score < 0.7)
            return res.json({error:'no food recognized'});
        
        let ingredients = await getIngredients(prediction.class)

        let result = checkForAllergens(ingredients, allergens);
        return res.status(200).json(result)
    }).catch((e) => {
        console.log("ERROR", e);
        return;
    });

})

app.post('/product/barcode', async(req, res, next)=>{
    //get barcode and allergens
    let barcode = req.body.barcode;
    let allergens = req.body.allergens;

    //retrieve name
    let name = await getNameFromBarcode(barcode);

    if(!name)
        return res.status(400).json({status : 'barcode not found in database', count : 0})
    
    let ingredients = await getIngredients(name)

    let result = checkForAllergens(ingredients, allergens);
    return res.json(result)
})

//db config

//services
const getAllIngredients = async ()=>{
    // result = await db.Query(
    //     'SELECT name FROM ingredient',
    //     []
    // );
    // const ingredients = helper.EmptyOrRows(result);
    // return ingredients;
    return ['tomatoes', 'eggs', 'pepper']
}

const getIngredients = async (name)=>{
    // result = await db.Query(
    //     `SELECT ingredient.name FROM ingredient 
    //         INNER JOIN (ingredients_list, product) 
    //         ON product.name = ? 
    //         AND ingredients_list.product_id = product.ID 
    //         AND  ingredient.ID = ingredients_list.ingredient_ID`,
    //     [name]
    // );
    // const ingredients = helper.EmptyOrRows(result);
    // return ingredients;

    return ['tomatoes', 'eggs', 'pepper']
}

const getNameFromBarcode = async (barcode) =>{
    // result = await db.Query(
    //     `SELECT name FROM product WHERE barcode = ?`,
    //     [barcode]
    // );
    // const [name, ] = helper.EmptyOrRows(result);
    // return name;
    return 'Pasta'
}


//helper
const getUrlFromImg = (img) =>{
    // return "https://cdn.shopify.com/s/files/1/0482/0067/9587/products/IMG_5647_503x503.jpg?v=1600881730"
    return "https://images.ctfassets.net/uexfe9h31g3m/6QtnhruEFi8qgEyYAICkyS/baae41c24d12e557bcc35c556049f43b/Spaghetti_Bolognese_Lifestyle_Full_Bleed_Recipe_Image__1__copy.jpg?w=768&h=512&fm=jpg&fit=thumb&q=90&fl=progressive"
}

function EmptyOrRows(rows) {
    if (!rows) {
      return [];
    }
    return rows;
}

const checkForAllergens = (ingredients, allergens) =>{
    let count = 0
    let allergensFound = [];

    // if(!allergens[0])
    //     return {status : "safe", count : count}

    for (let allergen of allergens){
        if(ingredients.includes(allergen)){
            allergensFound[count] = allergen;
            count++;
        }
    }

    if(count == 0)
        return {status : "safe", count : count}

    return {status : "not safe", count : count}
}

//launch application
app.listen(PORT, (err)=>{
    if (err) throw err;
    console.log(`app running at: http://${IP}:${PORT}`);
})

