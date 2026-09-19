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
  highestQualification: "Ph.D. in Computer Science",
  specialization: "Machine Learning & Distributed Systems",
  totalYearsOfExperience: 16,
  officialEmail: "ananya.reddy@vishnu.edu.in",
  joiningYear: 2010,
  education: {
    highestQualification: "Ph.D",
    phdDetails: {
      course: "Ph.D.",
      branch: "Computer Science",
      specialization: "Distributed Machine Learning",
      institutionName: "IIT Madras",
      yearOfAward: 2012,
    },
    additionalPhdDetails: [],
    postdoctoralFellowshipDetails: {
      course: "Post-Doctoral Fellowship",
      branch: "Artificial Intelligence",
      institutionName: "National University of Singapore",
      yearOfAward: 2014,
    },
    pgDetails: {
      course: "M.Tech",
      branch: "Computer Science",
      institutionName: "IIT Bombay",
      yearOfPassing: 2008,
    },
    additionalPgDetails: [],
    ugDetails: {
      course: "B.Tech",
      branch: "Computer Science & Engineering",
      institutionName: "JNTU Hyderabad",
      yearOfPassing: 2006,
    },
    additionalUgDetails: [],
    phdStatus: "AWARDED",
    netSletSetGateOthers: "YES",
    qualifiedExam: "GATE",
    qualifiedYear: 2006,
  },
  // One row per date shape: real fromDate/toDate (what the current forms write)
  // and the legacy year-only fallback older records still carry.
  academicExperience: [
    { institutionName: "National University of Singapore", designation: "Post-Doctoral Fellow", fromDate: "2012-08-01", toDate: "2014-07-31" },
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
  recognition: {
    awardsRecognition: [
      { titleOfAward: "Best Teacher Award", awardingAgencyBody: "Shree Vishnu Educational Society", dateOfAward: "2023-09-05" },
      { titleOfAward: "Outstanding Reviewer Award", awardingAgencyBody: "IEEE Transactions on Neural Networks", dateOfAward: "2022-03-14" },
      { titleOfAward: "Early Career Research Excellence Award", awardingAgencyBody: "Indian Society for Technical Education", year: 2019 },
    ],
    professionalMemberships: [
      { body: "IEEE", memberSince: "2012-04-01" },
      { body: "ACME", sinceYear: 2013 },
      { body: "ISTE", sinceYear: 2015 },
    ],
    academicResponsibilities: [
      { category: "IQAC", description: "IQAC Coordinator for the Department of CSE", fromDate: "2022-06-01" },
      { category: "NBA", description: "NBA Documentation Lead for B.Tech CSE Accreditation", fromDate: "2021-01-01", toDate: "2023-06-30" },
      { category: "COMMITTEE_MEMBER", description: "Anti-Ragging Committee Member", fromYear: 2019 },
    ],
    newLabsEstablished: [
      { facilityDetails: "AI & Distributed Systems Research Lab", outcomes: "Supports 6 ongoing PhD projects and 3 externally funded grants" },
    ],
    fdpsWorkshopsMoocsCertifications: [
      { type: "FDP", titleOfTheProgram: "Faculty Development Program on Federated Learning", nameOfTheFacultyCoordinator: "Shree Vishnu Educational Society", fromDate: "2023-05-15" },
      { type: "WORKSHOP", titleOfTheProgram: "Advanced GPU Computing Workshop", nameOfTheFacultyCoordinator: "NVIDIA Deep Learning Institute", fromDate: "2022-11-02" },
      { type: "CERTIFICATION", titleOfTheProgram: "TensorFlow Advanced Techniques Specialization", nameOfTheFacultyCoordinator: "Coursera / DeepLearning.AI", year: 2021 },
    ],
  },
  otherInformation: "Reviewer for IEEE Transactions on Neural Networks, ACM Computing Surveys, and Springer Machine Learning. Doctoral committee member for 4 PhD scholars currently pursuing research in federated learning and edge AI.",
};

export const metadata = {
  title: "Demo Faculty Profile",
};

export default function FacultyPublicProfileDemoPage() {
  return <FacultyPublicProfileView profile={DEMO_PROFILE} />;
}
