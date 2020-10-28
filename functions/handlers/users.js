const { admin, db } = require('../util/admin');
const config = require('../util/config');
const firebase = require('firebase');
firebase.initializeApp(config);

const { validateSignupData, validateLoginData, reduceUserDetails } = require('../util/validators');

// Sign user up
exports.signup = (req, res) => {
    const newUser = {
        email: req.body.email,
        password: req.body.password,
        confirmPassword: req.body.confirmPassword,
        handle: req.body.handle
    };

    const { valid, errors } = validateSignupData(newUser);

    if (!valid) return res.status(400).json(errors);

    const noImg = 'no-img.png';

    let token, userId;

    db.doc(`/users/${newUser.handle}`)
    .get()
    .then(doc => {
        if (doc.exists) {
            return res.status(400).json({ handle: 'This handle is already taken' }); //400 Invalid request
        } else {
            return firebase
            .auth()
            .createUserWithEmailAndPassword(newUser.email, newUser.password)
        }
    })
    .then(data => {
        userId = data.user.uid;
        return data.user.getIdToken();
    })
    .then(idToken => {
        token = idToken;
        const userCredentials = {
            handle: newUser.handle,
            email: newUser.email,
            createdAt: new Date().toISOString(),
            imageUrl: `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${noImg}?alt=media`,
            userId
        };
        return db.doc(`/users/${newUser.handle}`).set(userCredentials);
    })
    .then(() => {
        return res.status(201).json({ token });
    })
    .catch(err => {
        console.error(err);
        if (err.code === 'auth/email-already-in-use') {
            return res.status(400).json({ email: 'Email is already in use' });
        } else {
            return res.status(500).json({ error: err.code });
        }
    })
}

//Log user in
exports.login = (req, res) => {
    const user = {
        email: req.body.email,
        password: req.body.password
    };

    const { valid, errors } = validateLoginData(user);

    if (!valid) return res.status(400).json(errors);

    firebase
    .auth()
    .signInWithEmailAndPassword(user.email, user.password)
    .then(data => {
        return data.user.getIdToken();
    })
    .then(token => {
        return res.json({ token });
    })
    .catch(err => {
        console.error(err);
        if (err.code === 'auth/wrong-password') {
            return res.status(403).json({ general: 'Wrong credentials, please try again'}); //Unauthorized (403)
        } else return res.status(500).json({ error: err.code });
    });
}

// Add user details
exports.addUserDetails = (req, res) => {
    let userDetails = reduceUserDetails(req.body);
    
    // Look for document of user
    db.doc(`/users/${req.user.handle}`)
    .update(userDetails) //userDetails will return whatever data that the user has entered
    .then(() => {
        return res.json({ message: 'Details added successfully' });
    })
    .catch(err => {
        console.error(err);
        return res.status(500).json({ error: err.code });
    });
}

// Upload profile image for user
exports.uploadImage = (req, res) => {
    const BusBoy = require('busboy');
    const path = require('path');
    const os = require('os');
    const fs = require('fs');

    const busboy = new BusBoy({ headers: req.headers });

    let imageFileName;
    let imageToBeUploaded = {};

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => { //Need to include all of these arguments for 'on' even though we don't them all
    if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') {
        return res.status(400).json({ error: 'Wrong file type sumbitted' }); //400 bad request
    }
    console.log(fieldname);
    console.log(filename);
    console.log(mimetype);
        //image.png, get extension (png) by taking the string after the last dot
        const imageExtension = filename.split('.')[filename.split('.').length-1];
        //541345134534.png - te file name itself
        imageFileName = `${Math.round(Math.random() * 100000000000)}.${imageExtension}`;
        //joining these creates the full file path
        const filePath = path.join(os.tmpdir(), imageFileName);
        //Object with 2 properties
        imageToBeUploaded = { filePath, mimetype };
        file.pipe(fs.createWriteStream(filePath));
    });
    busboy.on('finish', () => {
        admin.storage().bucket().upload(imageToBeUploaded.filePath, {
            resumable: false,
            metadata: {
                metadata: {
                    contentType: imageToBeUploaded.mimetype
                }
            }
        })
        .then(() => {
            const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${imageFileName}?alt=media`;
            return db.doc(`/users/${req.user.handle}`).update({ imageUrl });
        })
        .then(() => {
            return res.json({ message: 'Image uploaded successfuly'});
        })
        .catch(err => {
            console.error(err);
            return res.status(500).json({ error: err.code });
        });
    });
    busboy.end(req.rawBody);
};