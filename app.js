if (process.env.NODE_ENV !== 'production') { // Load environment variables from .env file in non-production environments
    require('dotenv').config();
}


const express = require('express');
const MongoStore = require('connect-mongo');
const path = require('path');
const mongoose = require('mongoose');
const port = process.env.PORT || 3000;
const ejsMate = require('ejs-mate');
const User = require('./models/user');
const Product = require('./models/product');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require("passport-local");
const flash = require('connect-flash');
const methodOverride = require('method-override');
const Bid = require('./models/bid');
const multer = require('multer');
const { storage } = require('./cloudconfig');
const upload = multer({ storage });


// Initialize the Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
// Set EJS as the view engine
app.set('view engine', 'ejs');
app.engine('ejs', ejsMate);

// Tell Express where the EJS files are stored
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse JSON bodies and serve static files
app.use(express.static(path.join(__dirname, 'public')));


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


const connectDB = async () => {
    try {
    await mongoose.connect(process.env.ATLASDB_URL);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}
// Connect to the database
connectDB();

const store = MongoStore.create({
    mongoUrl: process.env.ATLASDB_URL,
    touchAfter: 24 * 60 * 60, // time period in seconds
    crypto: {
        secret  : process.env.SECRET
    }
});

store.on("error", function(e){
    console.log("ERROR in MONGO SESSION STORE", e)
});

const sessionOptions = {
  store,
  secret : process.env.SECRET,
  resave : false,
  saveUninitialized : true,
  cookie : {
    expires : Date.now() + 7 * 24 * 60 * 60 * 1000,
    maxAge : 7 * 24 * 60 * 60 * 1000,
    httpOnly : true,   
  }  
}; 



app.use(session(sessionOptions));
app.use(flash());




app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
    // res.locals is an object passed to the view
    
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.currUser = req.user;
    
    next();
});

app.use((err, req, res, next) => {
    console.error(err);
    req.flash('error', err.message || 'Something went wrong!');
    res.redirect('/listings');  // Redirect to home page instead of rendering error
});

const isLoggedIn = (req, res, next) => {
    if (!req.isAuthenticated()) {
        req.flash("error", "You must be logged in.");
        req.session.redirectUrl = req.originalUrl;
        return res.redirect("/signup"); 
    }
    next();
};

const saveRedirectUrl = (req, res, next) => {
    if ( req.session.redirectUrl ){
        res.locals.redirectUrl = req.session.redirectUrl;
    }
    next();
}



// Function to check and end expired auctions
async function checkExpiredAuctions() {
    try {
        const now = new Date();
        const expiredProducts = await Product.find({
            auctionStatus: 'active',
            auctionEndTime: { $lte: now }
        }).populate('owner');

        for (let product of expiredProducts) {
            await endAuction(product._id);
        }
    } catch (error) {
        console.error('Error checking expired auctions:', error);
    }
}

// Function to end an auction
async function endAuction(productId) {
    try {
        const product = await Product.findById(productId);
        if (!product || product.auctionStatus === 'ended') return;

        // Find the highest bid
        const highestBid = await Bid.findOne({ 
            product: productId 
        }).sort({ amount: -1 }).populate('bidder');

        if (highestBid) {
            // Set winner
            product.winner = highestBid.bidder._id;
            product.winningBid = highestBid.amount;
            
            // Update bid statuses
            await Bid.findByIdAndUpdate(highestBid._id, { status: 'won' });
            await Bid.updateMany(
                { product: productId, _id: { $ne: highestBid._id } },
                { status: 'lost' }
            );
        }

        product.auctionStatus = 'ended';
        await product.save();

        console.log(`Auction ended for product: ${product.name}`);
    } catch (error) {
        console.error('Error ending auction:', error);
    }
}

// Run auction check every 60 seconds
setInterval(checkExpiredAuctions, 60000);




// Run auction check every minute

setInterval(async () => {
    try {
        const now = new Date();
        
        // Find all active auctions that have passed their end time
        const expiredAuctions = await Product.find({
            auctionStatus: 'active',
            auctionEndTime: { $lte: now }
        }).populate('lastBidder');

        for (let product of expiredAuctions) {
            // Mark auction as ended
            product.auctionStatus = 'ended';
            
            if (product.lastBidder && product.currentBid > product.startingBid) {
                // Set winner
                product.winner = product.lastBidder;
                product.winningBid = product.currentBid;
                
                // Mark winning bid as 'won'
                await Bid.findOneAndUpdate(
                    { product: product._id, bidder: product.lastBidder, amount: product.currentBid },
                    { status: 'won' }
                );
                
                // Mark all other bids as 'lost'
                await Bid.updateMany(
                    { 
                        product: product._id, 
                        status: 'active',
                        bidder: { $ne: product.lastBidder }
                    },
                    { status: 'lost' }
                );

                req.flash('success', `Auction ended for ${product.name}. Winner: ${product.lastBidder.username || 'Unknown'} with bid ₹${product.currentBid}`);
            } else {
                req.flash('info', `Auction ended for ${product.name}. No bids received.`);
            }

            await product.save();
        }
    } catch (error) {
        console.error('Error checking auction status:', error);
    }
}, 60000); // Check every minute

app.get('/', (req, res) => {
    res.redirect('/listings');
});
// Signup Route
app.get('/signup', (req, res) => {
  req.flash('success', 'Welcome to E-Reusable vender finder system!');
  res.render('./users/signup.ejs', {page : 'signup'});
  
});

app.post('/signup', async (req, res, next) => {
    
  try {
              let { username, email, password } = req.body.user;
              const userType = 'user';
              const newUser = new User({ email, username, userType });
              
              const registeredUser = await User.register(newUser, password);
              req.login(registeredUser, (err) => {
                  if (err) {
                      return next(err);
              }
              req.flash('success', 'Welcome to E-Reusable vender finder system!');
              res.redirect('/listings');
              });
    } catch (e) {
              req.flash("success", e.message);
              console.log(e);
              res.redirect('/signup');
          }
      }
);

// Login Route
app.post('/login',
    saveRedirectUrl,
    passport.authenticate('local', {
    failureRedirect: "/signup",
    failureFlash: true,
}), async (req, res) => {
    req.flash("success", "welcome back to E-Reusable Vender finder system");
    if(res.locals.redirectUrl){
        res.redirect(res.locals.redirectUrl);
    } else{
        res.redirect('/listings');
    } 
}
);


// this function check user is logged in or not

app.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.flash('success', 'you are logged out!');
        res.redirect('/listings');
    })
});


// Other routes...
app.get('/listings', async (req, res) => {
    try {
       
        res.locals.checkLog = req.isAuthenticated();
        const user = req.user;
        const products = await Product.find({auctionStatus: { $in: ['pending', 'active'] } })
                            .populate('lastBidder', 'username');
        
        if(user && user.userType === 'admin'){
            return res.render('admin', { 
                products: products,
                user: user,
                error_product_id: req.flash('error_product_id')[0] || null,
                error: req.flash('error'),
                success: req.flash('success'),
                user 
            });
        } 
        res.render('index', { 
            products: products,
            user: user,
            error_product_id: req.flash('error_product_id')[0] || null,
            error: req.flash('error'),
            success: req.flash('success'),
            checkLog: res.locals.checkLog
        });
    } catch (err) {
        console.error('Failed to fetch products:', err);
        req.flash('error', 'Failed to fetch products');
        res.redirect('/listings');
    }
});

app.get('/listings/add',  isLoggedIn, (req, res) => {
    
    res.render('add.ejs');
});

app.post('/listings/add', upload.single('product[imageurl]'), async (req, res) => {
    try {
            const newProduct = new Product(req.body.product);
            newProduct.owner = req.user._id; // Set the owner to the logged-in user

            if (req.file && req.file.path) {
                newProduct.imageUrl = req.file.path; // Use the uploaded file path
            }

            await newProduct.save();
            const user = await User.findById(req.user._id);
            user.productCount = (user.productCount || 0) + 1;
            await user.save();
            req.flash('success', 'new product added Successfully')
            res.redirect("/listings");
             
    } catch(e){
        req.flash('error', e.message);
    }
});
 
app.get('/listings/show/:id',isLoggedIn, async (req, res) => {
    try {
        
        const product = await Product.findById(req.params.id)
            .populate('owner', 'username')
            .populate('lastBidder', 'username')
            .populate('winner', 'username');
        
        const currUser = req.user;

        const bids = await Bid.find({ product: req.params.id })
            .populate('bidder', 'username')
            .sort({ timestamp: -1 });
        
        
        res.render('show', { 
            product, 
            bids,
            currUser
        });
        

    } catch (err) {
        console.log(err);
        req.flash('error', 'Failed to load product');
        res.redirect('/listings');
    }
});

app.get('/listings/edit/:id', isLoggedIn, async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).send('Product not found');
        }
        res.render('edit', { product: product });
    } catch (err) {
        console.error('Failed to fetch product:', err);
        req.flash('error', 'Failed to fetch product');
        res.redirect('/listings');
    }
});

app.post('/listings/edit/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const updatedData = req.body.product;
        const product = await Product.findByIdAndUpdate(productId, updatedData, { new: true });
        if (!product) {
            return res.status(404).send('Product not found');
        }
        res.redirect('/listings');
    } catch (err) {
        console.error('Failed to update product:', err);
        req.flash('error', 'Failed to update product');
        res.redirect(`/listings/edit/${req.params.id}`);
    }
});

app.delete('/listings/delete/:id', isLoggedIn , async (req, res) => {
    let { id } = req.params;
    await Product.findByIdAndDelete(id);
   
    req.flash('success', 'listing deleted Successfully')
    res.redirect('/listings');
});







app.get('/user/bids', async (req, res) => {
    try {
        res.locals.checkLog = req.isAuthenticated();
        const bids = await Bid.find({ bidder: req.user._id })
            .populate('product')
            .sort({ timestamp: -1 });
            
        res.render('users/bids', { bids });
    } catch (err) {
        req.flash('error',  'Failed to load bids' );
    }
});

app.post('/products/:id/bid', isLoggedIn, async (req, res) => {
    const product = await Product.findById(req.params.id);
    try {
        
       
        console.log(product);
        if (!product) {
            req.flash('error', 'Product not found');
            return res.redirect('/listings');
        }
        product.lastBidder = req.user._id;
        // Check if auction is still active
        if (product.auctionStatus === 'ended') {
            req.flash('error', 'This auction has ended');
            return res.redirect(`/listings/show/${product._id}`);
        }
         // If auction is active, check if time has passed
        if (product.auctionStatus === 'active' && new Date() > product.auctionEndTime) {
            product.auctionStatus = 'ended';
            await product.save();
            req.flash('error', 'This auction has ended');
            return res.redirect(`/listings/show/${product._id}`);
        }

        const bidAmount = parseInt(req.body.amount);
        const currentBid = product.currentBid || product.startingBid;

        if (bidAmount <= currentBid) {
            req.flash('error', 'Bid must be higher than current bid');
            return res.redirect(`/listings/show/${product._id}`);
        }

        // Check if this is the first bid (auction is pending)
        const isFirstBid = product.auctionStatus === 'pending';

        if (isFirstBid) {
            // Start the auction timer
            const now = new Date();
            product.auctionStartTime = now;
            product.auctionEndTime = new Date(now.getTime() + product.auctionDuration);
            product.auctionStatus = 'active';
            console.log(`Auction started for product ${product.name}. Ends at: ${product.auctionEndTime}`);
            await product.save();
        }

        // Mark previous highest bids as 'active' (they're now outbid)
        await Bid.updateMany(
            { product: product._id, status: 'active' },
            { status: 'active' } // Keep as active until auction ends
        );

        // Create new bid
        const bid = new Bid({
            amount: bidAmount,
            product: product._id,
            bidder: req.user._id,
            status: 'active'
        });
        await bid.save();

        // Update product's current bid
        product.currentBid = bidAmount;
        product.lastBidder = req.user._id;
        await product.save();

        if (isFirstBid) {
            req.flash('success', 'Bid placed successfully! Auction has started and will end in 2 minutes.');
        } else {
            req.flash('success', 'Bid placed successfully!');
        }

        res.redirect(`/listings/show/${product._id}`);
    } catch (err) {
        console.error('Bid error:', err);
        req.flash('error', 'Failed to place bid');
        res.redirect(`/listings/show/${product._id}`);
    }
});
app.get('/products/history', isLoggedIn, async (req, res) => {
    try {
        const checkLog = req.isAuthenticated();
        if (!checkLog) {
            req.flash('error', 'You must be logged in to view bid history');
            return res.redirect('/signup');
        }
        const products = await Product.find({ auctionStatus: 'ended' })
            .populate('owner', 'username')
            .populate('lastBidder', 'username')
            .populate('winner', 'username');
        res.render('bidhistory', { products, checkLog });
    } catch (err) {
        console.error('Failed to fetch bid history:', err);
        req.flash('error', 'Failed to fetch bid history');
        res.redirect('/listings');
    }
});

app.get('/user/user', isLoggedIn, async (req, res) => {
    try {
        const checkLog = req.isAuthenticated();
        const users = await User.find({ userType: 'user' });
        res.render('users/userList.ejs', { users, checkLog });
    } catch (err) {
        console.error('Failed to fetch users:', err);
        req.flash('error', 'Failed to fetch users');
        res.redirect('/listings');
    }
});

app.delete('/users/remove/:id', isLoggedIn , async (req, res) => {
    let { id } = req.params;
    await User.findByIdAndDelete(id);   
    req.flash('success', 'User removed successfully');
    res.redirect('/user/user');
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
