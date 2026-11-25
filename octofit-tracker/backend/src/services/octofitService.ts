import mongoose from 'mongoose';
import { Activity, Team, User, Workout } from '../models/index.js';

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

export async function listActivities() {
  return Activity.find().lean();
}

export async function createActivity(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw httpError(400, 'Activity fields are required');
  }
  const { userId, teamId, type, minutes } = input as {
    userId?: unknown;
    teamId?: unknown;
    type?: unknown;
    minutes?: unknown;
  };
  if (!isObjectId(userId) || !isObjectId(teamId)) {
    throw httpError(400, 'A valid userId and teamId are required');
  }
  if (typeof type !== 'string' || type.trim().length === 0) {
    throw httpError(400, 'Activity type is required');
  }
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1) {
    throw httpError(400, 'Minutes must be a positive number');
  }

  const [user, team] = await Promise.all([
    User.findById(userId),
    Team.findById(teamId),
  ]);
  if (!user || !team) {
    throw httpError(404, 'User or team was not found');
  }

  const activity = await Activity.create({
    user: user._id,
    team: team._id,
    type: type.trim(),
    minutes,
    points: minutes,
    occurredAt: new Date(),
  });
  return activity.toObject();
}

export async function listTeams() {
  return Team.find().lean();
}

export async function createTeam(input: unknown) {
  if (!input || typeof input !== 'object') {
    throw httpError(400, 'Team fields are required');
  }
  const { name, mascot, members } = input as {
    name?: unknown;
    mascot?: unknown;
    members?: unknown;
  };
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw httpError(400, 'Team name is required');
  }
  if (typeof mascot !== 'string' || mascot.trim().length === 0) {
    throw httpError(400, 'Team mascot is required');
  }

  const memberIds = members === undefined ? [] : members;
  if (!Array.isArray(memberIds) || memberIds.some((id) => !isObjectId(id))) {
    throw httpError(400, 'Team members must be valid user IDs');
  }
  const existingMembers = await User.find({ _id: { $in: memberIds } }).select('_id');
  if (existingMembers.length !== memberIds.length) {
    throw httpError(404, 'One or more team members were not found');
  }

  const team = await Team.create({
    name: name.trim(),
    mascot: mascot.trim(),
    members: existingMembers.map((member) => member._id),
  });
  await User.updateMany({ _id: { $in: memberIds } }, { $set: { team: team._id } });
  return team.toObject();
}

export async function getLeaderboard() {
  const totals = await Activity.aggregate<{ _id: mongoose.Types.ObjectId; totalPoints: number }>([
    { $group: { _id: '$team', totalPoints: { $sum: '$points' } } },
    { $sort: { totalPoints: -1, _id: 1 } },
  ]);
  const teams = await Team.find({
    _id: { $in: totals.map((entry) => entry._id) },
  }).lean();
  const teamsById = new Map(teams.map((team) => [team._id.toString(), team]));

  return totals
    .map((entry) => {
      const team = teamsById.get(entry._id.toString());
      return team ? { teamName: team.name, totalPoints: entry.totalPoints } : null;
    })
    .filter((entry): entry is { teamName: string; totalPoints: number } => entry !== null)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function suggestWorkouts(userEmail: string) {
  const user = await User.findOne({ email: userEmail });
  if (!user) {
    throw httpError(404, 'User was not found');
  }

  const recentActivity = await Activity.findOne({ user: user._id }).sort({ occurredAt: -1 }).lean();
  const activityFocus: Record<string, string> = {
    run: 'endurance',
    cycle: 'cardio',
    strength: 'strength',
    walk: 'mobility',
  };
  const focus = activityFocus[recentActivity?.type ?? ''] ?? user.fitnessGoal;
  if (!focus) {
    return [];
  }

  const workouts = await Workout.find({ focus }).lean();
  return workouts.map((workout) => ({
    ...workout,
    reason: `Recommended for ${focus} based on ${recentActivity?.type ? `${recentActivity.type} activity` : `${user.fitnessGoal} fitness goal`}.`,
  }));
}

export { User };
