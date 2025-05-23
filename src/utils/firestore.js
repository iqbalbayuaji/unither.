import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

// Collection names
const CLASSES_COLLECTION = 'classes';
const USERS_COLLECTION = 'users';
const CLASS_MEMBERS_COLLECTION = 'class_members';
const ASSIGNMENTS_COLLECTION = 'assignments';

// Generate a unique class code (6 characters alphanumeric)
export const generateClassCode = async () => {
  // Try up to 5 times to find a unique code
  for (let attempt = 0; attempt < 5; attempt++) {
    // Custom code generator
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    // Check if this code already exists in the database
    const existingClasses = await firestore()
      .collection(CLASSES_COLLECTION)
      .where('classCode', '==', result)
      .get();
    
    // If no existing class has this code, return it
    if (existingClasses.empty) {
      return result;
    }
  }
  
  // If after multiple attempts we still have duplicates, add timestamp to ensure uniqueness
  const timestamp = new Date().getTime().toString(36).substring(0, 2).toUpperCase();
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  
  return result + timestamp;
};

// Create a new class
export const createClass = async (classData) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Generate a unique class code
    const classCode = await generateClassCode();
    
    // Create the class document
    const classRef = await firestore().collection(CLASSES_COLLECTION).add({
      name: classData.name,
      description: classData.description,
      maxUsers: classData.maxUsers || 30,
      createdBy: currentUser.uid,
      createdAt: firestore.FieldValue.serverTimestamp(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
      classCode: classCode,
      active: true
    });

    // Add the creator as a member with role "teacher"
    await firestore().collection(CLASS_MEMBERS_COLLECTION).add({
      classId: classRef.id,
      userId: currentUser.uid,
      role: 'teacher',
      joinedAt: firestore.FieldValue.serverTimestamp(),
      displayName: currentUser.displayName || '',
      email: currentUser.email || ''
    });

    return {
      success: true,
      classId: classRef.id,
      classCode
    };
  } catch (error) {
    console.error('Error creating class:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Join a class with a class code
export const joinClass = async (classCode) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Find the class with this code
    const classesSnapshot = await firestore()
      .collection(CLASSES_COLLECTION)
      .where('classCode', '==', classCode)
      .where('active', '==', true)
      .get();

    if (classesSnapshot.empty) {
      return {
        success: false,
        error: 'Invalid class code or class is no longer active'
      };
    }

    const classDoc = classesSnapshot.docs[0];
    const classData = classDoc.data();
    const classId = classDoc.id;

    // Check if user is already a member
    const memberSnapshot = await firestore()
      .collection(CLASS_MEMBERS_COLLECTION)
      .where('classId', '==', classId)
      .where('userId', '==', currentUser.uid)
      .get();

    if (!memberSnapshot.empty) {
      return {
        success: false,
        error: 'You are already a member of this class'
      };
    }

    // Check if the class is full
    const membersSnapshot = await firestore()
      .collection(CLASS_MEMBERS_COLLECTION)
      .where('classId', '==', classId)
      .get();

    if (membersSnapshot.size >= classData.maxUsers) {
      return {
        success: false,
        error: 'This class has reached its maximum number of members'
      };
    }

    // Add user as a member with role "student"
    await firestore().collection(CLASS_MEMBERS_COLLECTION).add({
      classId: classId,
      userId: currentUser.uid,
      role: 'student',
      joinedAt: firestore.FieldValue.serverTimestamp(),
      displayName: currentUser.displayName || '',
      email: currentUser.email || ''
    });

    return {
      success: true,
      classId: classId
    };
  } catch (error) {
    console.error('Error joining class:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get all classes the current user is a member of
export const getUserClasses = async () => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Get all class memberships for the user
    const membershipSnapshot = await firestore()
      .collection(CLASS_MEMBERS_COLLECTION)
      .where('userId', '==', currentUser.uid)
      .get();

    if (membershipSnapshot.empty) {
      return [];
    }

    // Get the class IDs
    const classIds = membershipSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        classId: data.classId,
        role: data.role,
        joinedAt: data.joinedAt
      };
    });

    // Get class details for each class
    const classes = await Promise.all(
      classIds.map(async ({ classId, role, joinedAt }) => {
        const classDoc = await firestore()
          .collection(CLASSES_COLLECTION)
          .doc(classId)
          .get();
        
        if (!classDoc.exists) return null;
        
        const classData = classDoc.data();
        return {
          id: classId,
          name: classData.name,
          description: classData.description,
          role: role,
          joinedAt: joinedAt,
          classCode: classData.classCode,
          createdBy: classData.createdBy
        };
      })
    );

    // Filter out any null values (classes that might have been deleted)
    return classes.filter(c => c !== null);
  } catch (error) {
    console.error('Error getting user classes:', error);
    return [];
  }
};

// Get class details
export const getClassDetails = async (classId) => {
  try {
    const classDoc = await firestore()
      .collection(CLASSES_COLLECTION)
      .doc(classId)
      .get();

    if (!classDoc.exists) {
      return null;
    }

    return {
      id: classDoc.id,
      ...classDoc.data()
    };
  } catch (error) {
    console.error('Error getting class details:', error);
    return null;
  }
};

// ASSIGNMENT FUNCTIONS FOR ONLINE SYNC

// Create a new assignment in a class
export const createAssignment = async (classId, assignmentData) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Create the assignment document
    const assignmentRef = await firestore()
      .collection(CLASSES_COLLECTION)
      .doc(classId)
      .collection(ASSIGNMENTS_COLLECTION)
      .add({
        ...assignmentData,
        createdBy: currentUser.uid,
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp()
      });

    return {
      success: true,
      assignmentId: assignmentRef.id
    };
  } catch (error) {
    console.error('Error creating assignment:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get all assignments for a class
export const getClassAssignments = async (classId) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const assignmentsSnapshot = await firestore()
      .collection(CLASSES_COLLECTION)
      .doc(classId)
      .collection(ASSIGNMENTS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();

    if (assignmentsSnapshot.empty) {
      return [];
    }

    return assignmentsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt && typeof data.createdAt.toDate === 'function' 
          ? data.createdAt.toDate().toISOString() 
          : new Date().toISOString(),
        updatedAt: data.updatedAt && typeof data.updatedAt.toDate === 'function' 
          ? data.updatedAt.toDate().toISOString() 
          : new Date().toISOString(),
        deadline: data.deadline && typeof data.deadline.toDate === 'function' 
          ? data.deadline.toDate().toISOString() 
          : data.deadline || null
      };
    });
  } catch (error) {
    console.error('Error getting class assignments:', error);
    return [];
  }
};

// Update an assignment
export const updateClassAssignment = async (classId, assignmentId, updatedData) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    await firestore()
      .collection(CLASSES_COLLECTION)
      .doc(classId)
      .collection(ASSIGNMENTS_COLLECTION)
      .doc(assignmentId)
      .update({
        ...updatedData,
        updatedAt: firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser.uid
      });

    return {
      success: true
    };
  } catch (error) {
    console.error('Error updating assignment:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Delete an assignment
export const deleteClassAssignment = async (classId, assignmentId) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    await firestore()
      .collection(CLASSES_COLLECTION)
      .doc(classId)
      .collection(ASSIGNMENTS_COLLECTION)
      .doc(assignmentId)
      .delete();

    return {
      success: true
    };
  } catch (error) {
    console.error('Error deleting assignment:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Set up real-time listener for assignments
export const subscribeToClassAssignments = (classId, onUpdate) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const unsubscribe = firestore()
      .collection(CLASSES_COLLECTION)
      .doc(classId)
      .collection(ASSIGNMENTS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
        const assignments = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt && typeof data.createdAt.toDate === 'function' 
              ? data.createdAt.toDate().toISOString() 
              : new Date().toISOString(),
            updatedAt: data.updatedAt && typeof data.updatedAt.toDate === 'function' 
              ? data.updatedAt.toDate().toISOString() 
              : new Date().toISOString(),
            deadline: data.deadline && typeof data.deadline.toDate === 'function' 
              ? data.deadline.toDate().toISOString() 
              : data.deadline || null
          };
        });
        onUpdate(assignments);
      }, error => {
        console.error('Error in assignment listener:', error);
      });

    return unsubscribe;
  } catch (error) {
    console.error('Error setting up assignment listener:', error);
    return () => {};
  }
};

// Get all members of a class
export const getClassMembers = async (classId) => {
  try {
    const currentUser = auth().currentUser;
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    // Get all members of the class
    const membersSnapshot = await firestore()
      .collection(CLASS_MEMBERS_COLLECTION)
      .where('classId', '==', classId)
      .orderBy('joinedAt', 'asc')  // Order by join date
      .get();

    if (membersSnapshot.empty) {
      return [];
    }

    // Process the member documents
    return membersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        displayName: data.displayName || 'Unnamed User',
        email: data.email || '',
        role: data.role || 'student',
        joinedAt: data.joinedAt && typeof data.joinedAt.toDate === 'function'
          ? data.joinedAt.toDate().toISOString()
          : new Date().toISOString(),
        isCurrentUser: data.userId === currentUser.uid
      };
    });
  } catch (error) {
    console.error('Error getting class members:', error);
    return [];
  }
}; 