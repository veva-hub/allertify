require('dotenv').config();
const cors = require('cors');
const express = require('express');
const mysql = require('promise-mysql2');
const fileUpload = require('express-fileupload');
const TeachableMachine = require("@sashido/teachablemachine-node");

const app = express();
const env = process.env
const IP = env.IP;
const PORT = env.PORT;
const appIP = env.appIP;

//middleware
app.use(express.urlencoded({ extended: true, }));
app.use(express.static('public'));
app.use(express.json());
app.use(
    fileUpload({
        limits: {
            fileSize: 10 * 1024 * 1024,
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

app.get('/ingredients', async (req, res, next) => {
    console.log('***********************************************************************')
    console.log('get /ingredients')
    let ingredients = await getAllIngredients();
    console.log(ingredients)
    res.json(ingredients);
})

app.post('/product/imagerecognition', async (req, res, next) => {
    console.log('***********************************************************************')
    console.log('post /product/imagerecognition')
    console.log(req.body)
    //get image and allergens
    let img = req.body.imgUrl;
    img = img ? img.substring(1, img.length - 1) : '';
    let allergens = req.body.allergens;
    allergens = allergens ? getAllergensAsArray(allergens) : [];

    let url = img
    //load model
    let prediction;

    const model = new TeachableMachine({
        modelUrl: env.MODEL
    });

    await model.classify({
        imageUrl: url,
    }).then(async (predictions) => {
        //get highest value
        prediction = getHighestValue(predictions);

        // check if highest value is greater that 0.7
        if (prediction.score < 0.7 || prediction.class === "Not food") {
            console.log('no food recognized')
            return res.status(400).json({ error: 'no food recognized' });
        }

        let ingredients = await getIngredients(prediction.class)

        let result = checkForAllergens(ingredients, allergens);
        let score = Math.round(prediction.score * 10000) / 100
        result = { ...result, name: prediction.class, prediction: score }
        console.log(result)

        return res.status(200).json(result)
    }).catch((e) => {
        console.log("ERROR in image recognition", e);
        return res.status(400).json({ error: e });
    });
})

app.post('/product/barcode', async (req, res, next) => {
    console.log('***********************************************************************')
    console.log('post product/barcode')
    console.log(req.body)

    //get barcode and allergens
    let barcode = req.body.barcode;
    let allergens = req.body.allergens;
    allergens = allergens ? getAllergensAsArray(allergens) : [];

    //retrieve name
    let name = await getNameFromBarcode(barcode);

    if (!name) {
        console.log('barcode not found in database')
        return res.status(400).json({ error: 'barcode not found in database' })
    }

    let ingredients = await getIngredients(name)
    console.log(ingredients)
    console.log(allergens)

    let result = checkForAllergens(ingredients, allergens);
    result = { ...result, name: name }
    console.log(result)

    return res.status(200).json(result)
})

//db config
const dbConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME
};

//create a new connection to the databse
const ConnectToDatabase = async () => {
    let connection = mysql.createConnection(dbConfig);
    return connection;
}

//end the connection with the database
const EndConnection = (connection) => {
    connection.end();
}

//execute the query
async function Query(sql, parms) {
    try {
        let conn = await ConnectToDatabase()
        let [result,] = await conn.query(sql, parms);
        EndConnection(conn);
        return result;
    } catch (e) {
        console.log('An error occured while executing the query', e)
    }
}

//services
const getAllIngredients = async () => {
    let result = await Query(
        'SELECT name FROM ingredient',
        []
    );
    const ingredients = EmptyOrRows(result);
    for (let i = 0; i < ingredients.length; i++) {
        ingredients.push(ingredients[0].name);
        ingredients.shift();
    }
    return ingredients;
}

const getIngredients = async (name) => {
    let result = await Query(
        `SELECT ingredient.name FROM ingredient 
            INNER JOIN (ingredients_list, product) 
            ON product.name = ? 
            AND ingredients_list.product_id = product.ID 
            AND  ingredient.ID = ingredients_list.ingredient_ID`,
        [name]
    );
    const ingredients = EmptyOrRows(result);
    for (let i = 0; i < ingredients.length; i++) {
        ingredients.push(ingredients[0].name);
        ingredients.shift();
    }
    return ingredients;
}

const getNameFromBarcode = async (barcode) => {
    let product = await Query(
        `SELECT name FROM product WHERE barcode = ?`,
        [barcode]
    );
    if (product.length != 0)
        return product[0].name;
    return '';
}


//helper
const getAllergensAsArray = (allergens) => {
    let fIndex = 0, result = [];
    for (let i = 0; i < allergens.length; i++) {
        if (allergens[i] == ',') {
            result.push(allergens.substring(fIndex, i))
            fIndex = i + 1;
        }
        if (i === allergens.length - 1)
            result.push(allergens.substring(fIndex))
    }
    return result;
}

const getHighestValue = (predictions) => {
    predictions.sort((a, b) => b.score - a.score);
    console.log(predictions)

    return predictions[0]
}

const EmptyOrRows = (rows) => {
    if (!rows) return [];
    return rows;
}

const checkForAllergens = (ingredients, allergens) => {
    let count = 0
    let allergensFound = '';
    console.log("ingredients:", ingredients)

    if (allergens.length == 0)
        return { status: "safe", count: count }

    for (let allergen of allergens) {
        for (let ingredient of ingredients) {
            if (ingredient.match(allergen) && !(allergen === 'Egg' && ingredient.match('Eggplant')) && allergen !== '') {
                allergensFound += `${allergen}, `;
                count++;
            }
        }
    }
    allergensFound = allergensFound.substring(0, allergensFound.length - 2)
    if (count == 0 || allergensFound == ', ')
        return { status: "safe", count: 0 }

    return { status: "not safe", count: count, allergensFound: allergensFound }
}

//launch application
app.listen(PORT, async (err) => {
    if (err) throw err;
    console.log('app running at: ', appIP)
})
