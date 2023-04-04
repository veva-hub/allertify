const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const axios = require('axios');
const express = require('express');
const formData = require('form-data');
const mysql = require('promise-mysql2');
const fileUpload = require('express-fileupload');
const TeachableMachine = require("@sashido/teachablemachine-node");

const app = express();
const env = process.env
const IP = env.IP;
const PORT = env.PORT;
const appIP = env.appIP;

//middleware
app.use(express.urlencoded({ extended : true, }));
app.use(express.static('public'));
app.use(express.json());
app.use(
    fileUpload({
        limits: {
            fileSize: 10*1024*1024,
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

    const imgPath = __dirname + '/uploads/' + img.name;
 
    // Move the uploaded image to our upload folder and continue with image recognition
    let url;
    img.mv(imgPath).then(async () =>{ 
        url = await getUrlFromImg(imgPath)
        //load model
        let prediction;

        const model = new TeachableMachine({
            modelUrl: env.MODEL
        });

        await model.classify({
        imageUrl: url,
        }).then(async (predictions) => {
            console.log(predictions)
            //get highest value
            prediction = getHighestValue(predictions);

            // check if highest value is greater that 0.7
            if(prediction.score < 0.7)
                return res.status(400).json({error:'no food recognized'});
            
            let ingredients = await getIngredients(prediction.class)

            let result = checkForAllergens(ingredients, allergens);
            result = {...result, name : prediction.class}
            return res.status(200).json(result)
        }).catch((e) => {
            console.log("ERROR", e);
            return;
        });
    })
})

app.post('/product/barcode', async(req, res, next)=>{
    //get barcode and allergens
    let barcode = req.body.barcode;
    let allergens = req.body.allergens;

    //retrieve name
    let name = await getNameFromBarcode(barcode);

    if(!name)
        return res.status(400).json({error : 'barcode not found in database'})
    
    let ingredients = await getIngredients(name)

    let result = checkForAllergens(ingredients, allergens);
    result = {...result, name : name}
    return res.status(200).json(result)
})

//db config
const dbConfig = {
    host: env.DB_HOST,
    // port : env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME
};

//create a new connection to the databse
const ConnectToDatabase = async () =>{
  let connection = mysql.createConnection(dbConfig);
  return connection;
}

//end the connection with the database
const EndConnection = (connection) =>{
  connection.end();
}

//execute the query
async function Query (sql, parms) {
    try{
        let conn = await ConnectToDatabase()
        let [result, ] = await conn.query(sql, parms);
        EndConnection(conn);
        return result;
    } catch (e) {
        console.log('An error occured', e)
    }
}

//services
const getAllIngredients = async ()=>{
    let result = await Query(
        'SELECT name FROM ingredient',
        []
    );
    const ingredients = EmptyOrRows(result);
    for(let i = 0; i<ingredients.length; i++){
        ingredients.push(ingredients[0].name);
        ingredients.shift();
    }
    return ingredients;
}

const getIngredients = async (name)=>{
    let result = await Query(
        `SELECT ingredient.name FROM ingredient 
            INNER JOIN (ingredients_list, product) 
            ON product.name = ? 
            AND ingredients_list.product_id = product.ID 
            AND  ingredient.ID = ingredients_list.ingredient_ID`,
        [name]
    );
    const ingredients = EmptyOrRows(result);
    for(let i = 0; i<ingredients.length; i++){
        ingredients.push(ingredients[0].name);
        ingredients.shift();
    }
    return ingredients;
}

const getNameFromBarcode = async (barcode) =>{
    let result = await Query(
        `SELECT name FROM product WHERE barcode = ?`,
        [barcode]
    );
    const [product, ] = EmptyOrRows(result);
    return product.name;
}


//helper
const getUrlFromImg = (imgPath) =>{
    return new Promise((resolve, reject) =>{
        const params = {
            'host' : "https://freeimage.host/api/1/upload",
            'key': '6d207e02198a847aa98d0a2a901485a5',
            'action' : 'upload',
            'format' : 'json'
        }
    
        let form = new formData();
        form.append('source', fs.createReadStream(imgPath));
    
        axios.post(`${params.host}?key=${params.key}&action=${params.action}&format=${params.format}`, form).then((res) =>{
            resolve(res.data.image.url);
        }).catch((e) =>{
            reject(e)
        })
    })
}
const getHighestValue = (predictions) =>{
    predictions.sort((a, b) => b.score - a.score);

    return predictions[0]
}

const EmptyOrRows = (rows) => {
    if (!rows) {
      return [];
    }
    return rows;
}

const checkForAllergens = (ingredients, allergens) =>{
    let count = 0
    let allergensFound = [];
    console.log(ingredients)

    if(allergens.length == 0)
        return {status : "safe", count : count}

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

