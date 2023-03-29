require('dotenv').config();
const fs = require('fs')
const http = require('http');
const cors = require('cors');
const axios = require('axios');
const express = require('express');
const formData = require('form-data');
const querystring = require('querystring');
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
 
    // Move the uploaded image to our upload folder
    img.mv(imgPath);

    //save image as url
    let url = getUrlFromImg(imgPath)

    //load model
    let prediction;

    const model = new TeachableMachine({
        modelUrl: env.MODEL
    });

    await model.classify({
    imageUrl: url,
    }).then(async (predictions) => {
        console.log("Predictions:", predictions);
        //get highest value
        prediction = predictions[0]

        // check if highest value is greater that 0.7
        if(prediction.score < 0.7)
            return res.status(400).json({error:'no food recognized'});
        
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
        return res.status(400).json({error : 'barcode not found in database'})
    
    let ingredients = await getIngredients(name)

    let result = checkForAllergens(ingredients, allergens);
    return res.status(200).json(result)
})

//db config
const dbConfig = {
    host: env.DB_HOST,
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
    let conn = await ConnectToDatabase()
    let [result, ] = await conn.query(sql, parms);
    EndConnection(conn);
  return result;
}

//services
const getAllIngredients = async ()=>{
    result = await Query(
        'SELECT name FROM ingredient',
        []
    );
    const ingredients = EmptyOrRows(result);
    return ingredients;
}

const getIngredients = async (name)=>{
    result = await db.Query(
        `SELECT ingredient.name FROM ingredient 
            INNER JOIN (ingredients_list, product) 
            ON product.name = ? 
            AND ingredients_list.product_id = product.ID 
            AND  ingredient.ID = ingredients_list.ingredient_ID`,
        [name]
    );
    const ingredients = EmptyOrRows(result);
    return ingredients;
}

const getNameFromBarcode = async (barcode) =>{
    result = await db.Query(
        `SELECT name FROM product WHERE barcode = ?`,
        [barcode]
    );
    const [name, ] = helper.EmptyOrRows(result);
    return name;
}


//helper
const getUrlFromImg = (imgPath) =>{
    // var data = querystring.stringify({
    //     image : img
    //   });
    // const params = {
    //     'key': '6d207e02198a847aa98d0a2a901485a5',
    //     'action' : 'upload',
    //     'format' : 'json',
    // }

    // var form = new formData();
    // form.append('source', fs.createReadStream(imgPath));

    // form.submit(`https://freeimage.host/api/1/upload?key=${params.key}&action=${params.action}&format=${params.format}`, (err, response)=>{
    //     if(err) 
    //         console.log(err)
        
    //     console.log(response)
    // })
    
    // fs.readFile(imgPath, {encoding: 'base64'}, (err, base64)=>{
    //     if(err) console.log('there is an error', err)


    //     http.request
    //     const options = {
    //         host: env.POSTURL || `https://freeimage.host/api/1/upload?key=${params.key}&action=${params.action}&source=${params.source}&format=${params.format}`,
    //         method: 'POST',
    //       };
        
    //       let httpreq = http.request(options, function (response) {
    //         response.setEncoding('utf8');
    //         response.on('data', function (chunk) {
    //           console.log("body: " + chunk);
    //         });
    //         response.on('end', function() {
    //           res.send('ok');
    //         })
    //       });
    //     //   httpreq.write(data);
    //       httpreq.end();

    // })
    // let postUrl = env.POSTURL || "https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5&action=upload&format=json"
    // axios.post(postUrl, {source : data}, {Headers:{'content-Type' : 'application/form-data'}})
    //   .then((response) =>{
    //     console.log(response)
    //   })
    
      


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

