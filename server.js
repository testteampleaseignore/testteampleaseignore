#!/usr/bin/env node


// load stdlibs
const fs = require('fs');
const path = require('path');

// load external libs
const express = require('express');
const dotenv = require('dotenv');
const pgp = require('pg-promise')();
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const busboy = require('connect-busboy');

// load other files 
const utils = require('./utils.js');

// load .env config file
dotenv.config();

// make an app
var app = express();
// set the view engine to ejs
app.set('view engine', 'ejs');
//This line is necessary for us to use relative 
// paths and access our resources directory
app.use(express.static(__dirname + '/')); 

// get db & its configuration...
// support old use of db-config.json for now;
// TODO: get rid of db-config.json because we can just use .env
if(process.env.DATABASE_URL) {
    var db = pgp(process.env.DATABASE_URL);
} else {
    var dbConfig = JSON.parse(fs.readFileSync('db-config.json', 'utf8'));
    var db = pgp(dbConfig);
}

// Create a session and initialize
// a not-so-secret secret key
app.use(session({
	secret: process.env.SECRET || 'whisper', 
	saveUninitialized: true,
	resave: true,
	// pass our database in here so that we 
	// can serialize sessions inside of it
	store: new pgSession({pgPromise: db})
}));

// setup POST method processing
// NOTE: database needs to exist at this point, maybe?
app.use(busboy({immediate: true }));

// One way we could handle score upload logic
var PLACEMENTS_TO_POINTS = {
	1: 10,
	2: 5,
	3: 3,
	4: 2,
	5: 1	
}


app.get('/', function(req, res) {
	res.redirect('/dashboard');
})

app.get('/login', function(req, res)
{
	// Should present the user with a /login form
	res.render('pages/login_form', {
		my_title: 'Login',
		loggedIn: utils.isLoggedIn(req)
	});
});

app.post('/login', function(req, res)
{
	// look for fields in the request object,
	// set them on the form object
	var form = {}; 
	req.busboy.on('field', function(key, value) {
		form[key] = value;
	});
	// when done reading the request, proceed to
	// access the form fields we received 
	req.busboy.on('finish', function() {

		// Validate the user's submitted login form by
		// (1) Checking if the hash of the submitted password 
		//   matches the one we have stored in our database,
		// SQLQ uery to get user_name and password_hash from users table
		var check_login = "SELECT id, password_hash FROM users WHERE user_name='" + 
			form.username + "';"
		db.oneOrNone(check_login)
			.then(function(result) {
				// (2) On success, redirect to the homepage
				if(result) {
					if(bcrypt.compareSync(form.password, result.password_hash)) {
					 // Passwords match
					 console.log(`User logged in: ${result.id}`);
					 req.session.userID = result.id;
					 req.session.save(function(err) {
					 	res.redirect('/dashboard');
					 }); 
					} else {
					 // (3) On different failures, return the user to the 
					 // login page and display a new error message explaining 
					 // what happened
					 // Passwords don't match
					 res.redirect('/login'); 
					}
				} else {
					// Username was not found
					res.redirect('/login');
				}
			})
			.catch(function(result) {
			    console.log(result);
		  	});	
	});
});


app.get('/logout', function(req, res)
{
	req.session.userID = null;
	req.session.save(function(err) {
		res.redirect('/dashboard');
	});
});

app.get('/register', function(req, res)
{
	res.render('pages/registrationPage', {
		my_title: 'Register',
		error: req.query.error,
		loggedIn: utils.isLoggedIn(req)
	});
});

app.post('/register', function(req, res)
{
	var form = {}; 
	req.busboy.on('field', function(key, value) {
		form[key] = value;
	});
	req.busboy.on('finish', function() {
		var password_hash = bcrypt.hashSync(form.password, 10);
		var insert_user = 'INSERT INTO users (user_name, email, password_hash) ' +
		                      `VALUES ('${form.username}', '${form.email}', '${password_hash}') ` +
		                      'RETURNING id;' 
		db.oneOrNone(insert_user)
		  .then(function(result) {
		  	if(result) { 
	      	  // Log the successfully registered user in; NOT working yet
	      	  req.session.userID = result.id;
	      	  req.session.save(function(err) {
				  // If everything looks good, send the now-logged-in user to the home page
				  res.redirect('/dashboard');
	      	  });
		  	}
		  })
		  .catch((result) => {
		  	console.log(result);
		    console.log(result.message);
		    if(result.message.startsWith('duplicate')) {
		    	var message = 'User already exists! Try again.';
		    	var urlEncodedMessage = encodeURIComponent(message);
		    	res.redirect(`/register?error=${urlEncodedMessage}`);
		    }
		  });
	});
});

app.get('/profile', function (req, res) {
	var loggedin = utils.ensureLoggedInOrRedirect(req, res);
	if(loggedin) {
		var query = 'SELECT user_name, points, ROW_NUMBER() OVER(ORDER BY points DESC)'+
		' FROM users WHERE id='+ req.session.userID +';';
		//var query1 = 'SELECT points FROM users WHERE id='+ req.session.userID +';';
		db.any(query)
		/*db.task('get-everything', task => {
	    	return task.batch([
	            task.one(query),
	            task.one(query1)
	        ]);
		})*/
		.then(function(user_info)
		{
			res.render('pages/playerProfilePage', {
				my_title: 'Player Profile',
				loggedIn: true,
				data: user_info
			});
		})
		.catch(function(results)
		{
			console.log('You messed up');
		});
	}
});

app.get('/leaderboard', function(req, res) {
	var loggedin = utils.ensureLoggedInOrRedirect(req, res);
	if(loggedin) {
		var query = 'SELECT user_name, points, ROW_NUMBER() OVER(ORDER BY points DESC)'+
		' FROM users';
		db.any(query)
		.then(function(user_info)
		{
			res.render('pages/Leaderboard', {
				my_title: 'Leaderboard',
				loggedIn: true,
				data: user_info
			});
		})
		.catch(function(results)
		{
			console.log('You messed up');
		});
	}
});

app.get('/startRound', function(req, res) {
	var loggedin = utils.ensureLoggedInOrRedirect(req, res);
	if(loggedin) {
		res.render('pages/startRound', {
			my_title: 'Start Round',
			loggedIn: true,
            keys: {
			googlemaps: process.env.GOOGLE_MAPS_API_KEY,
			pn_sub: process.env.PN_SUB_KEY, 
			pn_pub: process.env.PN_PUB_KEY
		}
		});
	}
});

app.post('/guessTargetLocation', function(req, res) {
	var loggedIn = utils.ensureLoggedInOrRedirect(req, res);
	if(loggedIn) {
		var form = {}

			req.busboy.on('field', function(key, value) {
				form[key] = value;
				console.log(key);
			});
			req.busboy.on('finish', function() {
				if(form.lat && form.lng && form.round_id) {
					console.log(form.round_id);
					db.one('SELECT target_latitude, target_longitude' + 
						   `FROM rounds WHERE id=${form.round_id};`)
						.then(function(results) {
							let distanceInMiles = utils.distance(
								results[0].target_latitude,
								results[0].target_longitude,
								form.lat, form.lng, 'M'
							)
							if((distanceInMiles / 5280) < 30) {
								let place = 1;
								res.render(
									`/dashboard?message=${utils.congratulations(place)}` +
									'&level=success');
							} else {
								res.render(
									`/rounds/${form.round_id}?message=${utils.sorry()}` +
									'$level=primary')
							}
						})
						.catch(function(results) {
							console.log(results);
						});
				} else {
					console.log("didn't pass something we needed to /guessTargetLocation");
					res.redirect('/dashboard');
				}
			})
		}
});

app.post('/uploadTarget', function(req, res) {

	loggedIn = utils.ensureLoggedInOrRedirect(req, res);
	if (loggedIn) {

		var form = {}
		req.busboy.on('field', function(key, value) {
			form[key] = value;
		});
		req.busboy.on('file', function(fieldname, file, filename) {

			// save the file to the filesystem
			console.log(`Received file: ${filename}`);
			form['filename'] = utils.generateUniqueSecureFilename(filename);
			let filepath = path.join(__dirname, 'uploads', form['filename'])
			console.log(`Saving the received file at: ${filepath}`);
	        let fstream = fs.createWriteStream(filepath);
	        file.pipe(fstream);
	        fstream.on('close', function () {
	            console.log('File saved.');
	        });

	        
		});
		req.busboy.on('finish', function() {
			// construct a SQL query to insert a round / target
            var date = new Date().toISOString()
         			.replace(/T/, ' ').replace(/\..+/, '');
		    var insert_round = 'INSERT INTO rounds ' +
		    '(starter_id, datetime_started, target_url, ' + 
		    'target_latitude, target_longitude) ' +
		    `values (${req.session.userID}, '${date}', ` +
		    `'${form['filename']}', ${form['lat']}, ${form['lng']});`;	 

		    // run the query!   
		    db.oneOrNone(insert_round)
			  .then(function(result) {
			  	res.redirect('/dashboard');
			  })
			  .catch((result) => {
			  	console.log(`sql: ${insert_round}`);
			  	console.log(`result: ${result}`);
		        res.redirect('/dashboard');
			  });
		});
	}
})

app.get('/rounds/:roundId', function(req, res) {
	
	var loggedIn = utils.ensureLoggedInOrRedirect(req, res);
	if(loggedIn) {
		var round_stmt =  "SELECT * FROM rounds " + 
						  "JOIN users on rounds.starter_id=users.id " + 
						  "WHERE rounds.id=" + req.params.roundId + ';';
		db.one(round_stmt)
		.then(round_user => {
	      if(round_user && utils.roundHasLocalTarget(round_user)) {
	      	res.render('pages/round', {
		      	my_title: "Round #" + req.params.roundId,
		        round: round_user,
		        loggedIn: true,
		        name: round_user.user_name,
		        debugging: req.query.debugging,
                keys: {
				    googlemaps: process.env.GOOGLE_MAPS_API_KEY,
				    pn_sub: process.env.PN_SUB_KEY, 
				    pn_pub: process.env.PN_PUB_KEY
                }
	      	})
	      } else {
	      	console.log('No such user, round, or invalid round');
	      	console.log(results);
	      	res.redirect('/dashboard');
	      }
		})
		.catch(function(error) {
		 	console.log(error);	  	
		 	res.redirect('/dashboard');
		});	
	}	
});

app.get('/dashboard', function(req, res) {
	var target_url = "SELECT target_url, id FROM rounds ORDER BY id DESC;";
	var loggedIn = utils.isLoggedIn(req);
	db.many(target_url)
		.then(function(results){

			// Don't display rounds for which the targets are "stale",
			// i.e. their file does not exist in the filesystem 
			results = results.filter(utils.roundHasLocalTarget);
			
			res.render('pages/dashboard', {
				my_title: 'FindIt!',
				message: req.query.message,
				loggedIn: loggedIn,
				roundsets: utils.groupBySetsOfN(results, 4)
			});
		})
		.catch(function(error){
			console.log(error);
			res.render('pages/dashboard', {
				my_title: 'FindIt!',
				loggedIn: loggedIn,
				roundsets: []
			});
		});
});


app.listen(process.env.PORT);
console.log(`${process.env.PORT} is the magic port`);

