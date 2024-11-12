import React from "react";
import { useQuery, gql } from "@apollo/client";

const GET_USERS = gql`
    query ($page: Int!) {
        tournaments(
            query: {
                filter: { videogameIds: [43868], past: true }
                perPage: 10
                page: $page
            }
        ) {
            nodes {
                id
                slug
                events(filter: { videogameId: 43868 }) {
                    entrants {
                        nodes {
                            name
                            participants {
                                user {
                                    discriminator
                                }
                                player {
                                    gamerTag
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;

export default function UserList() {
    const { error, data, loading } = useQuery(GET_USERS, {
        variables: { page: 1 },
    });

    console.log({ error, loading, data });
    if (loading) return <div>loading...</div>;
    if (error) return <div>error</div>;

    console.log("Hello");
    return data.tournaments.nodes[0].events[0].entrants.nodes.map((entrant) => {
        const list = [];
        entrant.participants.forEach((participant) => {
            list.push(
                <div key={participant.player.id}>
                    {participant.player.gamerTag +
                        ": " +
                        participant.user.discriminator}
                </div>
            );
        });
        return <div>{list}</div>;
    });
}
