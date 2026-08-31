import { FacultyPublicProfileView, type FacultyPublicProfile } from "@/components/faculty/FacultyPublicProfileView";

// Static showcase page (not backed by real data) demonstrating every section
// the public faculty template can render. Kept as a plain constant, not
// fetched, since its only job is design review - a real faculty member's
// data almost never populates every module at once. Lives at the literal
// "/demo" segment, which Next.js matches ahead of the "[param]" dynamic
// route, so it doesn't collide with real facultyid= links.
const DEMO_PROFILE: FacultyPublicProfile = {
  collegeName: "Shree Vishnu Educational Society",
  name: "Dr. Ananya Reddy",
  designation: "PROFESSOR",
  department: "Computer Science & Engineering",
  profilePhotoUrl: undefined,
  qualification: "Ph.D. in Computer Science",
  specialization: "Machine Learning & Distributed Systems",
  experienceYears: 16,
  officialEmail: "ananya.reddy@vishnu.edu.in",
  joiningYear: 2010,
  education: {
    highestQualification: "Ph.D",
    phdDetails: {
      degree: "Ph.D.",
      branch: "Computer Science",
      specialization: "Distributed Machine Learning",
      universityOrInstitute: "IIT Madras",
      yearOfCompletion: 2012,
    },
    additionalPhdDetails: [],
    postDoctoralDetails: {
      degree: "Post-Doctoral Fellowship",
      branch: "Artificial Intelligence",
      universityOrInstitute: "National University of Singapore",
      yearOfCompletion: 2014,
    },
    pgDetails: {
      degree: "M.Tech",
      branch: "Computer Science",
      universityOrInstitute: "IIT Bombay",
      yearOfCompletion: 2008,
    },
    additionalPgDetails: [],
    ugDetails: {
      degree: "B.Tech",
      branch: "Computer Science & Engineering",
      universityOrInstitute: "JNTU Hyderabad",
      yearOfCompletion: 2006,
    },
    phdStatus: "AWARDED",
    netSletQualificationYear: 2007,
    gateQualifiedYear: 2006,
  },
  previousInstitutions: [
    { institutionName: "National University of Singapore", designation: "Post-Doctoral Fellow", fromYear: 2012, toYear: 2014 },
    { institutionName: "BITS Pilani, Hyderabad Campus", designation: "Assistant Professor", fromYear: 2014, toYear: 2018 },
  ],
  research: {
    publications: [
      { title: "Federated Learning under Non-IID Data: A Convergence Study", coAuthors: "A. Reddy, K. Sharma", journalOrConference: "IEEE Transactions on Neural Networks", publicationYear: 2023, indexing: "SCI" },
      { title: "Scalable Distributed Training for Sparse Neural Networks", coAuthors: "A. Reddy, R. Iyer, S. Kumar", journalOrConference: "NeurIPS", publicationYear: 2022, indexing: "Scopus" },
      { title: "Energy-Aware Scheduling for Edge ML Inference", coAuthors: "A. Reddy, P. Nair", journalOrConference: "ACM Transactions on Embedded Computing Systems", publicationYear: 2021, indexing: "SCI" },
      { title: "A Survey of Privacy-Preserving Techniques in Federated Learning", coAuthors: "A. Reddy", journalOrConference: "ACM Computing Surveys", publicationYear: 2020, indexing: "SCI, Q1" },
    ],
    totalPublications: 42,
    totalCitations: 1180,
    hIndex: 19,
    i10Index: 27,
    googleScholarId: "AbC123DemoID",
    scopusAuthorId: "57200000000",
    orcidId: "0000-0002-1234-5678",
    authoredBooks: [
      { title: "Foundations of Distributed Machine Learning", publisher: "Springer", year: 2021 },
      { title: "Edge AI: Systems and Applications (Chapter 4)", publisher: "CRC Press", year: 2019 },
    ],
  },
  projects: {
    fundedProjects: [
      { title: "Federated Learning for Rural Healthcare Diagnostics", fundingAgency: "DST-SERB", year: 2023, status: "Ongoing", piOrCoPi: "PI" },
      { title: "Low-Power ML Accelerators for IoT Devices", fundingAgency: "AICTE-RPS", year: 2021, status: "Completed", piOrCoPi: "CO_PI" },
    ],
    consultancyProjects: [
      { title: "Predictive Maintenance Model for Manufacturing Client", clientOrAgency: "Vishnu Industrial Solutions Pvt. Ltd.", year: 2022, status: "Completed" },
    ],
    patents: { indianGranted: 2, indianFiled: 3, internationalGranted: 1, internationalFiled: 1 },
  },
  recognition: {
    awardEntries: [
      { title: "Best Teacher Award", awardingBody: "Shree Vishnu Educational Society", year: 2023 },
      { title: "Outstanding Reviewer Award", awardingBody: "IEEE Transactions on Neural Networks", year: 2022 },
      { title: "Early Career Research Excellence Award", awardingBody: "Indian Society for Technical Education", year: 2019 },
    ],
    professionalMemberships: [
      { body: "IEEE", sinceYear: 2012 },
      { body: "ACM", sinceYear: 2013 },
      { body: "ISTE", sinceYear: 2015 },
    ],
    adminResponsibilityEntries: [
      { category: "IQAC", description: "IQAC Coordinator for the Department of CSE", fromYear: 2022 },
      { category: "NBA_NAAC", description: "NBA Documentation Lead for B.Tech CSE Accreditation", fromYear: 2021, toYear: 2023 },
      { category: "COMMITTEE_MEMBER", description: "Anti-Ragging Committee Member", fromYear: 2019 },
    ],
    labsEstablished: [
      { facilityDetails: "AI & Distributed Systems Research Lab", outcomes: "Supports 6 ongoing PhD projects and 3 externally funded grants" },
    ],
    trainingEntries: [
      { type: "FDP", title: "Faculty Development Program on Federated Learning", organizer: "Shree Vishnu Educational Society", year: 2023 },
      { type: "WORKSHOP", title: "Advanced GPU Computing Workshop", organizer: "NVIDIA Deep Learning Institute", year: 2022 },
      { type: "CERTIFICATION", title: "TensorFlow Advanced Techniques Specialization", organizer: "Coursera / DeepLearning.AI", year: 2021 },
    ],
    nationalExposure: "Invited speaker at the National Conference on AI & Machine Learning (NCAIML) 2023, and technical committee member for INDICON 2022.",
    internationalExposure: "Visiting researcher at National University of Singapore (2018) and invited panelist at IEEE International Conference on Big Data (2022, virtual).",
  },
  otherInformation: "Reviewer for IEEE Transactions on Neural Networks, ACM Computing Surveys, and Springer Machine Learning. Doctoral committee member for 4 PhD scholars currently pursuing research in federated learning and edge AI.",
};

export const metadata = {
  title: "Demo Faculty Profile",
};

export default function FacultyPublicProfileDemoPage() {
  return <FacultyPublicProfileView profile={DEMO_PROFILE} />;
}
