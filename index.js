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
    origin: appIP,
    credentials: true
}));

app.get('/ingredients', async (req, res, next) => {
    console.log('\n***********************************************************************')
    console.log('\nIngredients called')
    let ingredients = await getAllAllergens();
    console.log(ingredients)
    res.json(ingredients);
})

app.post('/allergens', async (req, res, next) => {
    console.log('\n***********************************************************************')
    console.log('\nAllergens called')
    let allergens = await getAllergens(req.body.name);
    console.log('\nAllergens that match: ')
    console.log(allergens)
    console.log('\n', arrToString(allergens))
    res.json(arrToString(allergens));
})

app.post('/product/imagerecognition', async (req, res, next) => {
    console.log('\n***********************************************************************')
    console.log('\nImage recognition called')
    console.log('\nRequest:', req.body)
    //get image and allergens
    let img = req.body.imgUrl;
    let url = img ? img.substring(1, img.length - 1) : '';
    let allergens = req.body.allergens;
    allergens = allergens ? stringToArray(allergens) : [];

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
            console.log('\nNo food recognized')
            return res.status(400).json({ error: 'no food recognized' });
        }

        let ingredients = await getIngredients(prediction.class)

        let result = checkForAllergens(ingredients, allergens);
        let score = Math.round(prediction.score * 10000) / 100 //get the prediction score at e-2 precision
        result = { ...result, name: prediction.class, prediction: score }
        console.log('\n', result)

        return res.status(200).json(result)
    }).catch((e) => {
        console.log("ERROR in image recognition", e);
        return res.status(400).json({ error: e });
    });
})

app.post('/product/barcode', async (req, res, next) => {
    console.log('\n***********************************************************************')
    console.log('\nBarcode called')
    console.log('\nRequest:', req.body)

    //get barcode and allergens
    let barcode = req.body.barcode;
    let allergens = req.body.allergens;
    allergens = allergens ? stringToArray(allergens) : [];

    //retrieve name
    let name = await getNameFromBarcode(barcode);

    if (!name) {
        console.log('\nBarcode not found in database')
        return res.status(400).json({ error: 'barcode not found in database' })
    }

    let ingredients = await getIngredients(name)

    let result = checkForAllergens(ingredients, allergens);
    result = { ...result, name: name }
    console.log('\n', result)

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
const getAllAllergens = async () => {
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

const getAllergens = async (name) => {
    let allergens = await getAllAllergens();
    let result = allergens.filter(allergen => {
        return allergen.toLowerCase().match(name.toLowerCase())
    })
    return result;
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
const stringToArray = (strg) => {
    let fIndex = 0, result = [];
    for (let i = 0; i < strg.length; i++) {
        if (strg[i] == ',') {
            result.push(strg.substring(fIndex, i))
            fIndex = i + 1;
        }
        if (i === strg.length - 1)
            result.push(strg.substring(fIndex))
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
    let allergensFound = [];
    console.log("\nFood Ingredients:", ingredients)

    if (allergens.length == 0)
        return { status: "safe", count: count }

    for (let allergen of allergens) {
        for (let ingredient of ingredients) {
            if (ingredient.toLowerCase().match(allergen.toLowerCase())
                && !(allergen === 'Egg' && ingredient.match('Eggplant')) && allergen !== '') {
                allergensFound[count] = ingredient;
                count++;
            }
        }
    }
    if (count == 0 || allergensFound == ', ')
        return { status: "safe", count: 0 }

    return { status: "not safe", count: count, allergensFound: arrToString(allergensFound) }
}

const arrToString = (arr) => {
    let temp = '';
    for (let elmt of arr) {
        temp += `${elmt}, `
    }
    temp = temp.substring(0, temp.length - 2)
    return temp;
}

//launch application
app.listen(PORT, async (err) => {
    if (err) throw err;
    console.log('app running at: ', appIP)
})
