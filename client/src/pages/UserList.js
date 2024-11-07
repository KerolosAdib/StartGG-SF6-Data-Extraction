import React from "react";
import { useQuery, gql } from "@apollo/client";

const GET_USERS = gql`
    query {
        tournaments(
            query: {
                filter: { videogameIds: [43868], past: true }
                perPage: 20
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
    const { error, data, loading } = useQuery(GET_USERS);

    console.log({ error, loading, data });
    if (loading) return <div>loading...</div>;
    if (error) return <div>error</div>;

    return (
        <div>
            <div>
                {
                    data.tournaments.nodes[0].events[0].entrants.nodes[0]
                        .participants[0].user.discriminator
                }
            </div>
            <div>
                {
                    data.tournaments.nodes[0].events[0].entrants.nodes[0]
                        .participants[0].player.gamerTag
                }
            </div>
        </div>
    );
}
