import express from 'express';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { Application, Chat, Freelancer, Project, User } from './Schema.js';
import { Server } from 'socket.io';
import http from 'http';
import SocketHandler from './SocketHandler.js';

// Load environment variables
dotenv.config();

const app = express();

app.use(express.json());
app.use(bodyParser.json({ limit: "30mb", extended: true }));
app.use(bodyParser.urlencoded({ limit: "30mb", extended: true }));
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

io.on("connection", (socket) => {
  console.log("User connected");
  SocketHandler(socket);
});

const PORT = 6001;

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {

  // All your route handlers below

  app.post('/register', async (req, res) => {
    try {
      const { username, email, password, usertype } = req.body;
      const salt = await bcrypt.genSalt();
      const passwordHash = await bcrypt.hash(password, salt);
      const newUser = new User({ username, email, password: passwordHash, usertype });
      const user = await newUser.save();

      if (usertype === 'freelancer') {
        const newFreelancer = new Freelancer({ userId: user._id });
        await newFreelancer.save();
      }

      res.status(200).json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) return res.status(400).json({ msg: "User does not exist" });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

      res.status(200).json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/fetch-freelancer/:id', async (req, res) => {
    try {
      const freelancer = await Freelancer.findOne({ userId: req.params.id });
      res.status(200).json(freelancer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/update-freelancer', async (req, res) => {
    const { freelancerId, updateSkills, description } = req.body;
    try {
      const freelancer = await Freelancer.findById(freelancerId);
      freelancer.skills = updateSkills.split(',');
      freelancer.description = description;
      await freelancer.save();
      res.status(200).json(freelancer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/fetch-project/:id', async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      res.status(200).json(project);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/fetch-projects', async (req, res) => {
    try {
      const projects = await Project.find();
      res.status(200).json(projects);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/new-project', async (req, res) => {
    const { title, description, budget, skills, clientId, clientName, clientEmail } = req.body;
    try {
      const project = new Project({
        title,
        description,
        budget,
        skills: skills.split(','),
        clientId,
        clientName,
        clientEmail,
        postedDate: new Date()
      });
      await project.save();
      res.status(200).json({ message: "Project added" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/make-bid', async (req, res) => {
    const { clientId, freelancerId, projectId, proposal, bidAmount, estimatedTime } = req.body;
    try {
      const freelancer = await User.findById(freelancerId);
      const freelancerData = await Freelancer.findOne({ userId: freelancerId });
      const project = await Project.findById(projectId);
      const client = await User.findById(clientId);

      const application = new Application({
        projectId,
        clientId,
        clientName: client.username,
        clientEmail: client.email,
        freelancerId,
        freelancerName: freelancer.username,
        freelancerEmail: freelancer.email,
        freelancerSkills: freelancerData.skills,
        title: project.title,
        description: project.description,
        budget: project.budget,
        requiredSkills: project.skills,
        proposal,
        bidAmount,
        estimatedTime
      });

      await application.save();
      project.bids.push(freelancerId);
      project.bidAmounts.push(parseInt(bidAmount));
      freelancerData.applications.push(application._id);

      await project.save();
      await freelancerData.save();

      res.status(200).json({ message: "bidding successful" });
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/fetch-applications', async (req, res) => {
    try {
      const applications = await Application.find();
      res.status(200).json(applications);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/approve-application/:id', async (req, res) => {
    try {
      const application = await Application.findById(req.params.id);
      application.status = 'Accepted';
      await application.save();

      const project = await Project.findById(application.projectId);
      const freelancer = await Freelancer.findOne({ userId: application.freelancerId });
      const user = await User.findById(application.freelancerId);

      const remainingApplications = await Application.find({ projectId: application.projectId, status: "Pending" });
      remainingApplications.forEach(async (appli) => {
        appli.status = 'Rejected';
        await appli.save();
      });

      project.freelancerId = freelancer.userId;
      project.freelancerName = user.email;
      project.budget = application.bidAmount;
      project.status = "Assigned";
      freelancer.currentProjects.push(project._id);

      await project.save();
      await freelancer.save();

      res.status(200).json({ message: "Application approved!!" });
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/reject-application/:id', async (req, res) => {
    try {
      const application = await Application.findById(req.params.id);
      application.status = 'Rejected';
      await application.save();
      res.status(200).json({ message: "Application rejected!!" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/submit-project', async (req, res) => {
    const { projectId, projectLink, manualLink, submissionDescription } = req.body;
    try {
      const project = await Project.findById(projectId);
      project.projectLink = projectLink;
      project.manulaLink = manualLink;
      project.submissionDescription = submissionDescription;
      project.submission = true;
      await project.save();
      res.status(200).json({ message: "Project submitted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/approve-submission/:id', async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      const freelancer = await Freelancer.findOne({ userId: project.freelancerId });

      project.submissionAccepted = true;
      project.status = "Completed";

      freelancer.currentProjects.pop(project._id);
      freelancer.completedProjects.push(project._id);
      freelancer.funds = parseInt(freelancer.funds) + parseInt(project.budget);

      await project.save();
      await freelancer.save();

      res.status(200).json({ message: "submission approved" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/reject-submission/:id', async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      project.submission = false;
      project.projectLink = "";
      project.manulaLink = "";
      project.submissionDescription = "";
      await project.save();
      res.status(200).json({ message: "submission rejected" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/fetch-users', async (req, res) => {
    try {
      const users = await User.find();
      res.status(200).json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/fetch-chats/:id', async (req, res) => {
    try {
      const chats = await Chat.findById(req.params.id);
      res.status(200).json(chats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

}).catch((e) => {
  console.error(`❌ Error in DB connection: ${e.message}`);
});
